#!/usr/bin/env bash
# 可用性冒烟脚本：起服 → 登录 → 开会话 → 发消息 → 收回复 → 清理
# 用法：smoke.sh --binary [path] 或 smoke.sh --source
# 退出码：0 = 通过；非 0 = 失败

set -euo pipefail

readonly SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
readonly MOBI_ROOT="$(cd "${SCRIPT_DIR}/../../../.." && pwd)"

# shellcheck source=e2e-common.sh
source "${SCRIPT_DIR}/e2e-common.sh"

# ─── 配置 ────────────────────────────────────────────────────────────────────
readonly PROFILE_NAME="e2e"
e2e_load_profile "${PROFILE_NAME}" strict

readonly DAEMON_HEALTH_URL="http://localhost:${DAEMON_PORT}/health"
readonly MAX_WAIT_SECONDS=30
readonly MESSAGE_POLL_TIMEOUT=180
readonly POLL_INTERVAL=0.5

DAEMON_PID=""
TEST_SESSION_ID=""
CLEANUP_DONE=false

# ─── 参数解析 ─────────────────────────────────────────────────────────────────
MODE=""
BINARY_PATH=""

if [[ $# -eq 0 ]]; then
    e2e_log_error "用法: smoke.sh --binary [path] 或 smoke.sh --source"
    exit 1
fi

case "$1" in
    --binary)
        MODE="binary"
        if [[ $# -eq 2 ]]; then
            BINARY_PATH="$2"
        else
            # 检测当前平台（使用 bun 构建产物的目录结构）
            case "$(uname -s)-$(uname -m)" in
                Darwin-arm64) PLATFORM="bun-darwin-arm64" ;;
                Darwin-x86_64) PLATFORM="bun-darwin-x64" ;;
                Linux-x86_64) PLATFORM="bun-linux-x64" ;;
                Linux-aarch64) PLATFORM="bun-linux-arm64" ;;
                *)      e2e_log_error "不支持的平台: $(uname -s)-$(uname -m)"; exit 1 ;;
            esac
            BINARY_PATH="${MOBI_ROOT}/packages/cli/dist-exe/${PLATFORM}/mobi"
        fi
        if [[ ! -x "${BINARY_PATH}" ]]; then
            e2e_log_error "二进制文件不存在或不可执行: ${BINARY_PATH}"
            exit 1
        fi
        ;;
    --source)
        MODE="source"
        ;;
    *)
        e2e_log_error "未知参数: $1"
        e2e_log_error "用法: smoke.sh --binary [path] 或 smoke.sh --source"
        exit 1
        ;;
esac

# ─── 清理函数 ─────────────────────────────────────────────────────────────────
cleanup() {
    if [[ "${CLEANUP_DONE}" == "true" ]]; then
        return
    fi
    CLEANUP_DONE=true

    e2e_log_section "清理资源"

    # 停止 daemon（SIGTERM 走 daemon 有序关停并终止所有子会话）
    if [[ -n "${DAEMON_PID}" ]] && kill -0 "${DAEMON_PID}" 2>/dev/null; then
        e2e_log_info "终止 Daemon (PID: ${DAEMON_PID})"
        kill -TERM "${DAEMON_PID}" 2>/dev/null || true
        # 等待最多 10 秒
        local waited=0
        while kill -0 "${DAEMON_PID}" 2>/dev/null && (( waited < 20 )); do
            sleep 0.5
            waited=$((waited + 1))
        done
        if kill -0 "${DAEMON_PID}" 2>/dev/null; then
            kill -KILL "${DAEMON_PID}" 2>/dev/null || true
        fi
    fi
}

trap cleanup EXIT INT TERM

# ─── 端口占用检查（不清理，直接失败） ───────────────────────────────────────────
check_port_not_in_use() {
    local port=$1
    local pids
    pids=$(lsof -iTCP:"${port}" -sTCP:LISTEN -t 2>/dev/null || true)
    if [[ -n "${pids}" ]]; then
        e2e_log_error "端口 ${port} 被占用，进程 PID: ${pids}"
        e2e_log_error "请手动终止占用进程或检查是否有其他测试环境在运行"
        exit 1
    fi
}

# ─── 启动服务 ─────────────────────────────────────────────────────────────────
start_services() {
    e2e_log_section "检查端口占用"
    check_port_not_in_use "${DAEMON_PORT}"

    e2e_log_section "启动服务 (${MODE} 模式)"

    # 日志重定向目标目录可能不存在（e2e-cleanup 会删数据目录），先确保存在
    mkdir -p "${E2E_TMPDIR}"

    if [[ "${MODE}" == "binary" ]]; then
        e2e_log_info "使用二进制: ${BINARY_PATH}"
        "${BINARY_PATH}" --profile "${PROFILE_NAME}" daemon start-sync &> "${E2E_TMPDIR}/daemon.log" &
        DAEMON_PID=$!
    else
        e2e_log_info "使用源码: bun run"
        cd "${MOBI_ROOT}"
        bun run packages/cli/src/index.ts --profile "${PROFILE_NAME}" daemon start-sync &> "${E2E_TMPDIR}/daemon.log" &
        DAEMON_PID=$!
    fi

    e2e_log_info "Daemon PID: ${DAEMON_PID} "

    # 等待 daemon health 检查通过
    e2e_log_info "等待 Daemon 就绪..."
    local max_attempts=$(( MAX_WAIT_SECONDS * 2 ))
    local attempt=0
    while (( attempt < max_attempts )); do
        if curl -sf --max-time 2 "${DAEMON_HEALTH_URL}" &>/dev/null; then
            e2e_log_info "Daemon 就绪 ✓"
            return 0
        fi
        sleep "${POLL_INTERVAL}"
        attempt=$((attempt + 1))
    done

    e2e_log_error "Daemon 启动超时"
    e2e_log_error "=== Daemon 日志 (最后 50 行) ==="
    tail -50 "${E2E_TMPDIR}/daemon.log" || true

    exit 1
}

# ─── 登录获取 cookie ──────────────────────────────────────────────────────────
login() {
    e2e_log_section "登录"

    local token
    token=$(grep -E '^WEB_API_TOKEN=' ~/.mobi/profiles/"${PROFILE_NAME}".env | cut -d= -f2 | xargs)

    local response
    response=$(curl -sf -X POST \
        "http://localhost:${DAEMON_PORT}/api/auth" \
        -H "Content-Type: application/json" \
        -d "{\"accessToken\": \"${token}\"}" \
        -c "${E2E_TMPDIR}/cookies.txt" 2>&1) || {
        e2e_log_error "登录失败"
        e2e_log_error "响应: ${response}"
        exit 1
    }

    e2e_log_info "登录成功 ✓"
}

# ─── 等 daemon 完成本机自注册 ──────────────────────────────────────────────────
# daemon 启动时向库内自注册本机（machine 层本地化后唯一元素）——spawn 依赖
# machineId，未注册完就去建工作区/会话会拿不到。判据用 machines API 非空而非
# daemon.state.json：state 写在自注册之前，不代表可用
wait_for_daemon_ready() {
    local waited=0
    local machine_id=""
    while (( waited < 30 )); do
        machine_id=$(curl -sf -X GET \
            "http://localhost:${DAEMON_PORT}/api/machines" \
            -b "${E2E_TMPDIR}/cookies.txt" 2>/dev/null | jq -r '.machines[0].id // empty' 2>/dev/null)
        if [[ -n "${machine_id}" && "${machine_id}" != "null" ]]; then
            e2e_log_info "Daemon 就绪 ✓ (本机自注册完成，机器 ${machine_id:0:8}…，等待 $((waited / 2))s)"
            return 0
        fi
        sleep 0.5
        waited=$((waited + 1))
    done
    e2e_log_error "等待 daemon 就绪超时 (30s)：本机自注册未完成（机器列表为空）"
    exit 1
}

# ─── 获取或创建工作区 ─────────────────────────────────────────────────────────
get_or_create_workspace() {
    e2e_log_section "获取工作区"

    wait_for_daemon_ready

    # 先获取机器列表
    local machines
    machines=$(curl -sf -X GET \
        "http://localhost:${DAEMON_PORT}/api/machines" \
        -b "${E2E_TMPDIR}/cookies.txt") || {
        e2e_log_error "获取机器列表失败"
        exit 1
    }

    local machine_id
    machine_id=$(echo "${machines}" | jq -r '.machines[0].id')

    # 获取工作区列表
    local workspaces_response
    workspaces_response=$(curl -sf -X GET \
        "http://localhost:${DAEMON_PORT}/api/workspaces" \
        -b "${E2E_TMPDIR}/cookies.txt") || {
        e2e_log_error "获取工作区列表失败"
        exit 1
    }

    local workspace_count
    workspace_count=$(echo "${workspaces_response}" | jq '.workspaces | length')

    if [[ "${workspace_count}" -eq 0 ]]; then
        e2e_log_info "创建工作区 ~/workspace/demo"
        local create_response
        create_response=$(curl -sf -X POST \
            "http://localhost:${DAEMON_PORT}/api/workspaces" \
            -H "Content-Type: application/json" \
            -b "${E2E_TMPDIR}/cookies.txt" \
            -d "{\"name\": \"Demo\", \"machineId\": \"${machine_id}\", \"folders\": [{\"path\": \"${HOME}/workspace/demo\", \"primary\": true}]}") || {
            e2e_log_error "创建工作区失败"
            exit 1
        }
        WORKSPACE_ID=$(echo "${create_response}" | jq -r '.workspace.id')
    else
        WORKSPACE_ID=$(echo "${workspaces_response}" | jq -r '.workspaces[0].id')
    fi

    e2e_log_info "工作区 ID: ${WORKSPACE_ID}"
}

# ─── 创建会话 ─────────────────────────────────────────────────────────────────
create_session() {
    e2e_log_section "创建会话"

    # 获取机器 ID
    local machines
    machines=$(curl -sf -X GET \
        "http://localhost:${DAEMON_PORT}/api/machines" \
        -b "${E2E_TMPDIR}/cookies.txt") || {
        e2e_log_error "获取机器列表失败"
        exit 1
    }

    local machine_id
    machine_id=$(echo "${machines}" | jq -r '.machines[0].id')

    if [[ -z "${machine_id}" || "${machine_id}" == "null" ]]; then
        e2e_log_error "未找到可用机器"
        exit 1
    fi

    local session_response
    session_response=$(curl -sf -X POST \
        "http://localhost:${DAEMON_PORT}/api/machines/${machine_id}/spawn" \
        -H "Content-Type: application/json" \
        -b "${E2E_TMPDIR}/cookies.txt" \
        -d "{\"directory\": \"${HOME}/workspace/demo\", \"workspaceId\": \"${WORKSPACE_ID}\"}") || {
        e2e_log_error "创建会话失败"
        exit 1
    }

    local response_type
    response_type=$(echo "${session_response}" | jq -r '.type')
    if [[ "${response_type}" != "success" ]]; then
        e2e_log_error "创建会话失败: $(echo "${session_response}" | jq -r '.message')"
        exit 1
    fi

    TEST_SESSION_ID=$(echo "${session_response}" | jq -r '.sessionId')
    if [[ -z "${TEST_SESSION_ID}" || "${TEST_SESSION_ID}" == "null" ]]; then
        e2e_log_error "会话 ID 无效"
        exit 1
    fi

    e2e_log_info "会话 ID: ${TEST_SESSION_ID}"
}

# ─── 发送消息并等待回复 ───────────────────────────────────────────────────────
send_message_and_wait_reply() {
    e2e_log_section "发送消息"

    local start_time
    start_time=$(date +%s)

    # 发送消息
    curl -sf -X POST \
        "http://localhost:${DAEMON_PORT}/api/sessions/${TEST_SESSION_ID}/messages" \
        -H "Content-Type: application/json" \
        -b "${E2E_TMPDIR}/cookies.txt" \
        -d '{"content": "只回复 OK"}' &>/dev/null || {
        e2e_log_error "发送消息失败"
        exit 1
    }

    e2e_log_info "消息已发送，等待 assistant 回复..."

    # 轮询消息列表，直到出现 assistant 回复
    local max_attempts=$(( MESSAGE_POLL_TIMEOUT * 2 ))
    local attempt=0

    while (( attempt < max_attempts )); do
        local messages
        messages=$(curl -sf -X GET \
            "http://localhost:${DAEMON_PORT}/api/sessions/${TEST_SESSION_ID}/messages?limit=10" \
            -b "${E2E_TMPDIR}/cookies.txt" 2>/dev/null) || true

        if [[ -n "${messages}" ]]; then
            # assistant 回复判据：消息 content.role 为 "agent"（新消息结构 role 嵌在 content 内）
            local has_assistant_reply
            has_assistant_reply=$(echo "${messages}" | jq '[.messages[] | select(.content.role == "agent")] | length > 0')

            if [[ "${has_assistant_reply}" == "true" ]]; then
                local end_time
                end_time=$(date +%s)
                local elapsed=$((end_time - start_time))
                e2e_log_info "收到 assistant 回复 ✓ (耗时: ${elapsed}s)"
                return 0
            fi
        fi

        sleep "${POLL_INTERVAL}"
        attempt=$((attempt + 1))
    done

    e2e_log_error "等待 assistant 回复超时 (${MESSAGE_POLL_TIMEOUT}s)"
    exit 1
}

# ─── 主流程 ───────────────────────────────────────────────────────────────────
main() {
    local overall_start
    overall_start=$(date +%s)

    start_services
    login
    get_or_create_workspace
    create_session
    send_message_and_wait_reply

    local overall_end
    overall_end=$(date +%s)
    local total_elapsed=$((overall_end - overall_start))

    e2e_log_section "冒烟测试通过 ✓"
    e2e_log_info "总耗时: ${total_elapsed}s"
}

main
