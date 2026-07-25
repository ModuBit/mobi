#!/usr/bin/env bash
#
# 监听对 mobi 进程（hub/runner/cli）的 SIGTERM 发送事件，抓出**谁**杀了进程。
#
# 背景：Unix 信号不携带发送者信息，进程内无法得知 SIGTERM 来源。本脚本在进程外
# 用 macOS Endpoint Security（eslogger）观测 signal 系统调用，输出 sender PID/命令。
#
# 使用：
#   sudo scripts/observe-sigterm.sh
#   sudo scripts/observe-sigterm.sh --all      # 不过滤 mobi，看全部 SIGTERM
#
# 依赖：macOS 13+（eslogger 内置）、jq（brew install jq）
# 权限：eslogger 需要 root 且系统 SIP 未完全禁用 Endpoint Security。
#       若 eslogger 无输出，改用 dtrace 备选（见脚本末尾注释）。
#
set -euo pipefail

ALL=false
[[ "${1:-}" == "--all" ]] && ALL=true

if ! command -v eslogger >/dev/null 2>&1; then
    echo "错误：未找到 eslogger（需 macOS 13+）" >&2
    exit 1
fi
if ! command -v jq >/dev/null 2>&1; then
    echo "错误：未找到 jq（brew install jq）" >&2
    exit 1
fi
if [[ $EUID -ne 0 ]]; then
    echo "错误：eslogger 需要 root，请用 sudo 运行" >&2
    exit 1
fi

echo "[observe-sigterm] 监听 SIGTERM 发送事件（ALL=$ALL）... Ctrl+C 停止"

# eslogger 输出每行一个 JSON 事件，字段大致：
#   { "event": { "action": "ES_EVENT_ACTION_NOTIFY", "signal": "SIGTERM",
#                "target": { "process": { "pid": <接收者>, "executable": {...} } },
#                "process": { "pid": <发送者>, "executable": {...}, "ppid": ... } } }
# 不同 macOS 版本字段略有差异，下方脚本对 mobi 进程过滤并友好打印。
eslogger signal --json 2>/dev/null | jq -c '
    select(.event.signal == "SIGTERM" or .event.signal == "SIGINT")
    | {
        time: (.timestamp // "n/a"),
        signal: .event.signal,
        sender_pid: (.event.process.pid // "n/a"),
        sender_ppid: (.event.process.ppid // "n/a"),
        sender: (.event.process.executable.path // .event.process.audit_token.process_name // "n/a"),
        target_pid: (.event.target.process.pid // "n/a"),
        target: (.event.target.process.executable.path // "n/a")
      }
' | while IFS= read -r line; do
    # 仅打印与 mobi 相关的事件（sender 或 target 含 mobi 路径/进程名）
    if $ALL || echo "$line" | grep -qiE 'mobi|claude|bun'; then
        echo "$line"
    fi
done

# ────────────────────────────────────────────────────────────────────────────
# 备选方案（eslogger 无输出时）—— dtrace，同样需要 root + SIP 允许 dtrace：
#
#   sudo dtrace -n '
#     proc:::signal-send
#     /args[1] == 15/
#     { printf("%Y SIGTERM from pid=%d (%s) -> pid=%d (%s)\n",
#              walltimestamp, pid, execname, args[0]->pr_pid, args[0]->pr_fname) }
#   '
#
# args[1]==15 即 SIGTERM；pid/execname 是发送者，args[0] 是接收者。
# macOS 默认 SIP 限制 dtrace 对非自身进程的观测，可能需要 `csrutil disable`
# （重启到恢复模式），不建议长期关闭 SIP。
