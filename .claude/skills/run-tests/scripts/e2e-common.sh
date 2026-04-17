#!/usr/bin/env bash
# E2E 测试环境共享函数
# 被 e2e-bootstrap.sh 和 e2e-cleanup.sh source 引入

# ─── 颜色 ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

# ─── 日志函数 ─────────────────────────────────────────────────────────────────
e2e_log_info()    { echo -e "${GREEN}[INFO]${RESET}  $*"; }
e2e_log_warn()    { echo -e "${YELLOW}[WARN]${RESET}  $*"; }
e2e_log_error()   { echo -e "${RED}[ERROR]${RESET} $*"; }
e2e_log_section() { echo -e "\n${BOLD}${CYAN}=== $* ===${RESET}"; }

# ─── Profile 加载 ─────────────────────────────────────────────────────────────
# 从 profile 文件加载配置到全局变量
# 参数：$1 = profile 名称
# 设置：HUB_PORT, WEB_PORT, E2E_TMPDIR, RUNNER_STATE_FILE
#       如果提供了 $2=strict 则文件不存在时退出，否则使用默认值
e2e_load_profile() {
    local profile_name="$1"
    local strict="${2:-}"
    local profile_file="${HOME}/.mobi/profiles/${profile_name}.env"

    if [[ -f "${profile_file}" ]]; then
        HUB_PORT=$(grep -E '^MOBI_LISTEN_PORT=' "${profile_file}" | head -1 | cut -d= -f2 | xargs)
        WEB_PORT=$(grep -E '^MOBI_WEB_PORT=' "${profile_file}" | head -1 | cut -d= -f2 | xargs)
        E2E_TMPDIR=$(grep -E '^MOBI_HOME=' "${profile_file}" | head -1 | cut -d= -f2 | xargs)
    elif [[ "${strict}" == "strict" ]]; then
        echo -e "${RED}[ERROR]${RESET} Profile 文件不存在: ${profile_file}"
        echo "请先运行: profiles/install.sh"
        exit 1
    else
        HUB_PORT=2224
        WEB_PORT=5175
        E2E_TMPDIR="${HOME}/.mobi-e2e"
    fi

    RUNNER_STATE_FILE="${E2E_TMPDIR}/runner.state.json"
}

# ─── Runner 管理函数 ──────────────────────────────────────────────────────────

e2e_read_runner_state() {
    local state_file="$1"
    RUNNER_PID=""
    RUNNER_HTTP_PORT=""

    if [[ ! -f "${state_file}" ]]; then
        return 1
    fi

    # 单次 jq 调用同时提取 pid 和 httpPort
    read -r RUNNER_PID RUNNER_HTTP_PORT < <(
        jq -r '(.pid // ""), (.httpPort // "")' "${state_file}" 2>/dev/null
    ) || true

    if [[ -z "${RUNNER_PID}" ]]; then
        return 1
    fi
    return 0
}

e2e_stop_runner() {
    local state_file="$1"

    if ! e2e_read_runner_state "${state_file}"; then
        e2e_log_info "Runner 状态文件不存在或无法解析"
        return 0
    fi

    if ! kill -0 "${RUNNER_PID}" 2>/dev/null; then
        e2e_log_info "Runner 进程未运行 (PID: ${RUNNER_PID})"
        return 0
    fi

    # 1. 获取并终止所有子进程
    if [[ -n "${RUNNER_HTTP_PORT}" ]]; then
        local children_json
        children_json=$(curl -sf -X POST "http://127.0.0.1:${RUNNER_HTTP_PORT}/list" 2>/dev/null \
            || echo '{"children":[]}')

        local child_pids
        child_pids=$(echo "${children_json}" | jq -r '.children[]?.pid // empty' 2>/dev/null || true)

        for cpid in ${child_pids}; do
            e2e_log_info "终止 Runner 子进程 (PID: ${cpid})"
            curl -sf -X POST "http://127.0.0.1:${RUNNER_HTTP_PORT}/stop-session" \
                -H 'Content-Type: application/json' \
                -d "{\"sessionId\": \"PID-${cpid}\"}" &>/dev/null || true
        done
    fi

    # 2. 优雅停止 Runner
    if [[ -n "${RUNNER_HTTP_PORT}" ]]; then
        e2e_log_info "通过 HTTP 优雅停止 Runner (PID: ${RUNNER_PID})"
        curl -sf -X POST "http://127.0.0.1:${RUNNER_HTTP_PORT}/stop" &>/dev/null || true
        sleep 1
    fi

    # 3. SIGTERM 兜底
    if kill -0 "${RUNNER_PID}" 2>/dev/null; then
        e2e_log_info "终止 Runner 进程 (PID: ${RUNNER_PID})"
        kill -TERM "${RUNNER_PID}" 2>/dev/null || true
    fi
}
