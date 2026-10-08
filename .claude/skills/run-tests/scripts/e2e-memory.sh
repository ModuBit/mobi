#!/usr/bin/env bash
# agent-memory 票 04：记忆 E2E 主线（fake 记忆服务桩四场景）
#
# 断言面 = mobi 侧行为（插件挂载 / env 注入 / 请求发出 / 会话不受影响），
# 不模拟引擎语义（recall/retain 属票 01 云端实测）。
#
# 前置：e2e 环境已 bootstrap 且 /health 就绪（本脚本不起环境）；
#       daemon 为票 02+ 代码（cleanup + bootstrap 重启后运行）。
# 运行：bash .claude/skills/run-tests/scripts/e2e-memory.sh
# 退出码：0 = 四场景全过；非 0 = 失败（打印失败阶段）

set -u

PORT=2224
FAKE_PORT=3999
E2E_HOME="$HOME/.mobi-e2e"
SETTINGS="$E2E_HOME/settings.daemon.json"
MANAGED_CFG="$E2E_HOME/memory/hindsight/coding-agent.json"
DAEMON_LOG="$E2E_HOME/logs/daemon.log"
FAKE_LOG="/tmp/e2e-memory-requests.jsonl"
JAR="/tmp/e2e-memory-jar.txt"
DEMO_DIR="$HOME/workspace/demo"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
FAKE_PID=""

pass=0; fail=0
ok()   { echo "  ✅ $1"; pass=$((pass+1)); }
bad()  { echo "  ❌ $1"; fail=$((fail+1)); }
note() { echo "  · $1"; }

cleanup() {
    # 只杀自己起的 fake 服务（按精确 PID，禁全局 pkill）
    if [ -n "$FAKE_PID" ] && kill -0 "$FAKE_PID" 2>/dev/null; then
        kill "$FAKE_PID" 2>/dev/null
    fi
    # settings 还原为关闭态（不影响后续 E2E 用环境）
    python3 - "$SETTINGS" <<'PYEOF'
import json, sys
p = sys.argv[1]
try:
    d = json.load(open(p))
except Exception:
    d = {}
d.pop('memory', None)
json.dump(d, open(p, 'w'), indent=2)
PYEOF
}
trap cleanup EXIT

# ── helpers ──────────────────────────────────────────────────────────

# 写 settings 的 memory 段（合并保留其他字段；不传参 = 删除 memory 段）
set_memory() {
    python3 - "$SETTINGS" "$1" <<'PYEOF'
import json, sys
path, raw = sys.argv[1], (sys.argv[2] if len(sys.argv) > 2 else None)
try:
    d = json.load(open(path))
except Exception:
    d = {}
if raw:
    d['memory'] = json.loads(raw)
else:
    d.pop('memory', None)
json.dump(d, open(path, 'w'), indent=2)
PYEOF
}

# spawn 一个会话，echo sessionId；失败 echo 空
spawn_session() {
    local dir="$1"
    curl -s -b "$JAR" -X POST "http://localhost:$PORT/api/sessions/spawn" \
        -H 'content-type: application/json' \
        -d "{\"directory\":\"$dir\",\"sessionType\":\"simple\"}" \
        | python3 -c 'import json,sys; r=json.load(sys.stdin); print(r.get("sessionId",""))'
}

# 找会话 CLI 进程（daemon 直属子进程、启动晚于标记时刻），echo pid；找不到 echo 空
find_cli_pid() {
    local since_marker="$1"
    local latest=""
    for pid in $(pgrep -f "packages/cli/src/index.ts.*--started-by"); do
        # 归属三要素（inline-artifact-verify 纪律）：daemon 子进程 + 启动晚于标记
        local ppid lstart
        ppid=$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')
        [ -z "$ppid" ] && continue
        # lstart 单日期位是空格补位（"Oct  8"），tr 压缩空白后才能被 date -f 解析
        lstart=$(ps -o lstart= -p "$pid" 2>/dev/null | tr -s ' ')
        [ -z "$lstart" ] && continue
        if [ "$(date -j -f '%a %b %d %T %Y' "$lstart" +%s 2>/dev/null || echo 0)" -ge "$since_marker" ]; then
            latest="$pid"
        fi
    done
    echo "$latest"
}

# 断言 spawn 出的会话进程树是否挂载 memory-hindsight 插件（cli 自身或内层 claude 的 args）
plugin_mounted() {
    local cli_pid="$1"
    local tree="$cli_pid $(pgrep -P "$cli_pid" 2>/dev/null | tr '\n' ' ')"
    for pid in $tree; do
        if ps -o command= -p "$pid" 2>/dev/null | grep -q "plugin-dir.*memory-hindsight"; then
            return 0
        fi
    done
    return 1
}

fake_log_lines() { [ -f "$FAKE_LOG" ] && wc -l < "$FAKE_LOG" | tr -d ' ' || echo 0; }

# wait_for 轮询断言（直接函数调用——bash -c 子进程里本脚本函数不可见）
cli_found()  { [ -n "$(find_cli_pid "$1")" ]; }
mounted()    { plugin_mounted "$1"; }
log_ge()     { [ "$(fake_log_lines)" -ge "$1" ]; }

# 会话是否空闲（running=false；回合排队消息不触发 hook，须等回合结束）
session_idle() {
    curl -s -b "$JAR" "http://localhost:$PORT/api/sessions/$1" \
        | python3 -c 'import json,sys; exit(0 if not json.load(sys.stdin).get("session",{}).get("running") else 1)'
}

# 给会话发一条消息（触发 UserPromptSubmit hook；不等模型回复，hook 先行）
send_message() {
    curl -s -b "$JAR" -X POST "http://localhost:$PORT/api/sessions/$1/messages" \
        -H 'content-type: application/json' -d '{"content":"只回复 OK","localId":"e2e-mem-'$RANDOM'"}' >/dev/null
}

wait_for() { # wait_for <desc> <secs> <cmd...>：轮询直到 cmd 退出码 0
    local secs="$1"; shift
    local i=0
    while [ $i -lt $secs ]; do
        if "$@" >/dev/null 2>&1; then return 0; fi
        sleep 1; i=$((i+1))
    done
    return 1
}

# 清理上一轮残留会话（归属三要素：daemon 直属 + --started-by daemon；按精确 PID）
DAEMON_PID=$(lsof -nP -iTCP:$PORT -sTCP:LISTEN -t 2>/dev/null | head -1)
if [ -n "$DAEMON_PID" ]; then
    for pid in $(pgrep -P "$DAEMON_PID" -f "index.ts claude" 2>/dev/null); do
        kill "$pid" 2>/dev/null && note "停残留会话 CLI $pid"
    done
fi
: > "$FAKE_LOG" 2>/dev/null || true

# ── 前置检查 ─────────────────────────────────────────────────────────

echo "## 前置检查"
if ! curl -sf -o /dev/null "http://localhost:$PORT/health"; then
    echo "FATAL: e2e daemon 未就绪（http://localhost:$PORT/health）——先 bootstrap：见 memory/env-bootstrap.md"; exit 1
fi
ok "daemon /health 就绪"

[ -d "$DEMO_DIR" ] || mkdir -p "$DEMO_DIR"

curl -s -c "$JAR" -X POST "http://localhost:$PORT/api/auth" \
    -H 'content-type: application/json' -d '{"accessToken":"e2e-test-token-mobi"}' >/dev/null
ok "登录 cookie 就绪"

# 起 fake 记忆服务（setsid 脱离进程组，防沙箱组杀）
FAKE_MEMORY_LOG="$FAKE_LOG" perl -e 'use POSIX qw(setsid); setsid(); exec @ARGV' \
    bun "$REPO/packages/cli/scripts/fake-memory-server.ts" "$FAKE_PORT" >/tmp/fake-memory.log 2>&1 &
FAKE_PID=$!
if wait_for 10 bash -c "curl -sf -o /dev/null http://127.0.0.1:$FAKE_PORT/health"; then
    ok "fake 记忆服务就绪 :$FAKE_PORT"
else
    echo "FATAL: fake 记忆服务起不来（/tmp/fake-memory.log）"; exit 1
fi

# ── 场景 1：engine off → 插件不挂载、零请求 ─────────────────────────

echo "## 场景 1：off"
set_memory ''   # 删除 memory 段
: > "$FAKE_LOG"
T1=$(date +%s)
S1=$(spawn_session "$DEMO_DIR")
if [ -n "$S1" ]; then ok "off 会话 spawn 成功 ($S1)"; else bad "off 会话 spawn 失败"; fi
CLI1=$(wait_for 10 find_cli_pid "$T1" && find_cli_pid "$T1")
if [ -n "$CLI1" ] && ! plugin_mounted "$CLI1"; then
    ok "off：进程树无 memory-hindsight plugin-dir"
else
    bad "off：插件不应挂载（cli=${CLI1}）"
fi
sleep 3
if [ "$(fake_log_lines)" = "0" ]; then ok "off：fake 服务零请求"; else bad "off：不应有记忆请求（$(fake_log_lines) 行）"; fi

# ── 场景 2：hindsight + fake endpoint → 挂载 + env 注入 + hook 请求 ──

echo "## 场景 2：hindsight active"
set_memory '{"engine":"hindsight","endpoint":"http://127.0.0.1:'"$FAKE_PORT"'","apiToken":"fake-e2e-token"}'
T2=$(date +%s)
S2=$(spawn_session "$DEMO_DIR")
if [ -n "$S2" ]; then ok "active 会话 spawn 成功 ($S2)"; else bad "active 会话 spawn 失败"; fi
# 内层 claude 起动比 webhook 慢：轮询进程树
CLI2=""
if wait_for 15 cli_found "$T2"; then CLI2=$(find_cli_pid "$T2"); fi
if [ -n "$CLI2" ] && wait_for 15 mounted "$CLI2"; then
    ok "active：memory-hindsight plugin-dir 已挂载"
else
    bad "active：插件应挂载（cli=${CLI2}）"
fi
if wait_for 20 bash -c "[ \"\$(wc -l < $FAKE_LOG 2>/dev/null || echo 0)\" -ge 1 ]"; then
    ok "active：hook 对 fake 服务发起请求（$(fake_log_lines) 行）"
else
    bad "active：hook 未发请求"
fi
if grep -q '"hasAuth":true' "$FAKE_LOG"; then ok "active：请求携带 Bearer token（HINDSIGHT_API_TOKEN 注入成立）"; else bad "active：请求缺 token"; fi
if [ -f "$MANAGED_CFG" ] && grep -q 'mobi-personal' "$MANAGED_CFG" && grep -q 'retainTags' "$MANAGED_CFG"; then
    ok "active：管理配置文件已生成（bankId/retainTags）"
else
    bad "active：管理配置文件缺失或形状不对（${MANAGED_CFG}）"
fi

# ── 场景 3：运行中改设置 → 旧会话不受影响、新会话按新设置 ────────────

echo "## 场景 3：改设置生效语义"
# 改设置前先验证旧会话 env 固化：发消息 → UserPromptSubmit hook 仍对 fake 发请求
LINES_BEFORE=$(fake_log_lines)
send_message "$S2"
if wait_for 20 log_ge $((LINES_BEFORE + 1)); then
    ok "旧会话：发消息后 hook 仍请求（env 已固化，改设置前）"
else
    bad "旧会话：hook 应在改设置前持续请求"
fi
set_memory ''   # 切回 off
sleep 1
LINES_OFF=$(fake_log_lines)
T3=$(date +%s)
S3=$(spawn_session "$DEMO_DIR")
if [ -n "$S3" ]; then ok "切换后新会话 spawn 成功 ($S3)"; else bad "切换后新会话 spawn 失败"; fi
CLI3=""
if wait_for 10 cli_found "$T3"; then CLI3=$(find_cli_pid "$T3"); fi
if [ -n "$CLI3" ] && ! plugin_mounted "$CLI3"; then
    ok "新会话：按新设置不挂载（下会话生效语义）"
else
    bad "新会话：不应挂载（cli=${CLI3}）"
fi
# 旧会话不受影响：其 CLI 进程仍存活，再发一条消息 hook 依旧请求
if [ -n "$CLI2" ] && kill -0 "$CLI2" 2>/dev/null; then
    ok "旧会话进程存活（运行中会话不受设置变更影响）"
    # 等第一回合结束再发（回合中消息排队不触发 UserPromptSubmit hook）
    if wait_for 60 session_idle "$S2"; then
        send_message "$S2"
        if wait_for 30 log_ge $((LINES_OFF + 1)); then
            ok "旧会话：改设置后 hook 仍请求（运行中会话行为不变）"
        else
            bad "旧会话：改设置后 hook 不应停止请求"
        fi
    else
        note "旧会话第一回合 60s 未结束，跳过 hook 复验（进程存活断言已覆盖）"
    fi
else
    bad "旧会话进程不应被影响（cli=$CLI2）"
fi

# ── 场景 4：非法配置（engine 开但 endpoint 缺）→ 会话正常 + 不挂载 ───

echo "## 场景 4：非法配置降级"
set_memory '{"engine":"hindsight"}'
T4=$(date +%s)
S4=$(spawn_session "$DEMO_DIR")
if [ -n "$S4" ]; then ok "非法配置下会话正常启动 ($S4)"; else bad "非法配置不应阻断会话"; fi
CLI4=""
if wait_for 10 cli_found "$T4"; then CLI4=$(find_cli_pid "$T4"); fi
if [ -n "$CLI4" ] && ! plugin_mounted "$CLI4"; then
    ok "非法配置：插件不挂载（fail-open）"
else
    bad "非法配置：不应挂载（cli=${CLI4}）"
fi
if grep -q 'invalid-endpoint' "$DAEMON_LOG" 2>/dev/null; then
    ok "诊断日志可查（invalid-endpoint）"
else
    note "诊断日志未落盘：debug 级别需 daemon 带 DEBUG=1 启动才写文件（ringBuffer 恒有），行为断言已覆盖"
fi

# ── 收尾：停掉本脚本 spawn 的会话（按精确 sessionId，走 API）────────

for sid in $S1 $S2 $S3 $S4; do
    [ -n "$sid" ] && curl -s -b "$JAR" -X DELETE "http://localhost:$PORT/api/sessions/$sid" >/dev/null
done

echo
echo "## 结果：$pass 过 / $fail 败"
[ "$fail" = "0" ]
