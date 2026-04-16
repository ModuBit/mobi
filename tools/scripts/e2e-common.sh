#!/usr/bin/env bash
# E2E 测试环境共享函数
# 被 e2e-bootstrap.sh 和 e2e-cleanup.sh source 引入

# ─── 日志函数 ─────────────────────────────────────────────────────────────────
e2e_log_info()    { echo -e "${GREEN}[INFO]${RESET}  $*"; }
e2e_log_warn()    { echo -e "${YELLOW}[WARN]${RESET}  $*"; }
e2e_log_error()   { echo -e "${RED}[ERROR]${RESET} $*"; }
e2e_log_section() { echo -e "\n${BOLD}${CYAN}=== $* ===${RESET}"; }

# ─── Runner 管理函数 ──────────────────────────────────────────────────────────

# 从 Runner 状态文件中读取 PID 和 HTTP 端口
# 参数：$1 = 状态文件路径
# 输出：设置 RUNNER_PID 和 RUNNER_HTTP_PORT 变量
# 返回：0 = 成功读取，1 = 文件不存在或解析失败
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

# 优雅终止 Runner 及其所有子进程
# 参数：$1 = 状态文件路径
# 流程：
#   1. 通过 /list 获取子进程列表
#   2. 逐个 /stop-session 终止子进程
#   3. 通过 /stop 优雅停止 Runner
#   4. 如进程仍在，SIGTERM 兜底
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

        # 使用 jq 提取子进程 PID 列表
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
