#!/usr/bin/env bash
# 验收残留 headless Chrome 清扫
#
# 背景（2026-10-31 实锤）：验收会话用 `&`/`nohup` 手动起的 headless Chrome（独立
# profile + 调试端口，做动效/触摸验收）在会话结束后无人收割——launchd 收养成孤儿，
# 里面留着验收时的 mobi E2E 页面（SSE 对已死 daemon 重连 + 流式渲染栈定时器），
# 单渲染器可烧 ~15% CPU + 800MB，撑过 15-18 天。e2e-cleanup.sh 的 daemon/端口清扫
# 管不到它们，故单列一步，由 cleanup 链调用，也可单独跑。
#
# 识别判据（刻意收窄，防误杀）：命令行**同时**含
#   --headless  且  --user-data-dir=/tmp/
# 日常浏览器 profile 在 ~/Library 不会命中；逐 PID 归属验证（必须是 Google Chrome）
# 后再杀，不是全局 pkill。杀主进程即可——helper 随主进程退场。

set -uo pipefail

pids=$(ps -Ao pid,command | awk '/--[h]eadless/ && /--user-data-dir=\/tmp\// {print $1}')

count=0
for pid in ${pids}; do
    # 归属验证：只杀确认是 Google Chrome 的进程（防同名特征的无关进程误伤）
    if ps -p "${pid}" -o command= 2>/dev/null | grep -q "Google Chrome"; then
        echo "清扫验收残留 headless Chrome (PID: ${pid})"
        # 必须用 /bin/kill：沙箱内 bash 内建 kill 会假成功（exit 0 但信号未送达）
        /bin/kill -9 "${pid}" 2>/dev/null || true
        count=$((count + 1))
    fi
done

echo "清扫完成：${count} 个实例"
exit 0
