#!/usr/bin/env bash
# E2E 测试环境引导脚本
# 直跑形态启动 Hub + Web Dev Server + Runner（start-sync 前台组件本体，不经
# supervisor 托管），等待所有服务就绪后保持前台运行
# Ctrl+C 或收到 SIGTERM 时自动清理所有子进程
# 通过 --profile e2e 加载配置

set -euo pipefail

readonly PROFILE_NAME="e2e"
readonly MOBI_ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"

# shellcheck source=e2e-common.sh
source "$(dirname "$0")/e2e-common.sh"

e2e_load_profile "${PROFILE_NAME}" strict

readonly HUB_HEALTH_URL="http://localhost:${HUB_PORT}/health"
readonly WEB_HEALTH_URL="http://localhost:${WEB_PORT}"
readonly MAX_WAIT_SECONDS=30
readonly MAX_RUNNER_WAIT_SECONDS=15
readonly POLL_INTERVAL=0.5

HUB_PID=""
WEB_PID=""
RUNNER_BG_PID=""
CLEANUP_DONE=false

# 自动清理占用端口的进程
auto_cleanup_port() {
    local port=$1
    local pids
    pids=$(lsof -iTCP:"${port}" -sTCP:LISTEN -t 2>/dev/null || true)
    if [[ -z "${pids}" ]]; then
        return 0
    fi

    e2e_log_warn "端口 ${port} 被占用，自动清理残留进程..."
    for pid in ${pids}; do
        e2e_log_info "终止进程 (PID: ${pid})"
        kill -9 "${pid}" 2>/dev/null || true
    done

    # 等待端口释放
    local waited=0
    while (( waited < 10 )); do
        local remaining
        remaining=$(lsof -iTCP:"${port}" -sTCP:LISTEN -t 2>/dev/null || true)
        if [[ -z "${remaining}" ]]; then
            e2e_log_info "端口 ${port} 已释放 ✓"
            return 0
        fi
        sleep 0.5
        waited=$((waited + 1))
    done

    e2e_log_error "端口 ${port} 清理失败，仍有进程占用"
    exit 1
}

# 检查端口是否被占用，是则自动清理
check_port() {
    local port=$1
    local output
    output=$(lsof -iTCP:"${port}" -sTCP:LISTEN -t 2>/dev/null || true)
    if [[ -n "${output}" ]]; then
        auto_cleanup_port "${port}"
    fi
}

# 轮询等待 URL 可用
wait_for_url() {
    local url=$1
    local name=$2
    local max_attempts=$(( MAX_WAIT_SECONDS * 2 ))
    local attempt=0

    while (( attempt < max_attempts )); do
        if curl -sf --max-time 2 "${url}" &>/dev/null; then
            return 0
        fi
        sleep "${POLL_INTERVAL}"
        attempt=$(( attempt + 1))
    done

    e2e_log_error "等待 ${name} 就绪超时（${MAX_WAIT_SECONDS}s）"
    return 1
}

# ─── 清理函数 ─────────────────────────────────────────────────────────────────
cleanup() {
    if [[ "${CLEANUP_DONE}" == true ]]; then
        return 0
    fi
    CLEANUP_DONE=true

    e2e_log_section "清理 E2E 测试环境"

    # 1. 优雅终止直跑子进程：hub/web/runner 均为 start-sync 直跑形态，
    #    是本脚本的直接子进程（PID 即 bun 本体），SIGTERM 走各自优雅清理。
    #    PPID 看门狗兜底：本脚本意外死亡时组件自行退出
    for name_pid in "Hub:${HUB_PID}" "Web Dev Server:${WEB_PID}" "Runner:${RUNNER_BG_PID}"; do
        local label="${name_pid%%:*}"
        local cpid="${name_pid##*:}"
        if [[ -n "${cpid}" ]] && kill -0 "${cpid}" 2>/dev/null; then
            e2e_log_info "终止 ${label} 进程 (PID: ${cpid})"
            kill -TERM "${cpid}" 2>/dev/null || true
            wait "${cpid}" 2>/dev/null || true
        fi
    done

    # 1.5 Runner 会话子进程兜底：按 state file 走 HTTP 逐个停止 claude 会话，
    #     再对 runner 本体补一发优雅停止（上一步 SIGTERM 已使其退出时自动跳过）
    e2e_stop_runner "${RUNNER_STATE_FILE}"

    # 2. 端口兜底清理：直跑进程若因异常脱离父子关系（如被 disown 的孙进程），
    #    按监听端口必杀，避免孤儿残留
    e2e_log_info "端口兜底清理..."
    local control_port=""
    if e2e_read_runner_state "${RUNNER_STATE_FILE}" 2>/dev/null && [[ -n "${RUNNER_HTTP_PORT}" ]]; then
        control_port="${RUNNER_HTTP_PORT}"
    fi
    for port in "${HUB_PORT}" "${WEB_PORT}" ${control_port}; do
        [[ -z "${port}" ]] && continue
        local pids
        pids=$(lsof -iTCP:"${port}" -sTCP:LISTEN -t 2>/dev/null || true)
        for pid in ${pids}; do
            e2e_log_info "端口兜底终止 ${port} (PID: ${pid})"
            kill -9 "${pid}" 2>/dev/null || true
        done
    done

    # 3. 清理数据目录（含 ready/failed flag）
    if [[ -d "${E2E_TMPDIR}" ]]; then
        e2e_log_info "清理数据目录: ${E2E_TMPDIR}"
        rm -rf "${E2E_TMPDIR}"
    fi

    e2e_log_info "清理完成"
}

trap cleanup SIGINT SIGTERM

# ─── 主流程 ───────────────────────────────────────────────────────────────────
main() {
    e2e_log_section "Mobi E2E 测试环境引导 (profile: ${PROFILE_NAME})"

    # 1. 检查端口
    e2e_log_info "检查端口占用情况..."
    check_port "${HUB_PORT}"
    check_port "${WEB_PORT}"
    e2e_log_info "端口 ${HUB_PORT}（Hub）和 ${WEB_PORT}（Web）均可用"

    # 2. 创建数据目录和日志目录
    e2e_log_info "创建数据目录: ${E2E_TMPDIR}"
    mkdir -p "${E2E_TMPDIR}/logs"
    # 清理上次残留的就绪信号（mkdir -p 不删旧文件）
    rm -f "${E2E_TMPDIR}/ready.flag"

    # 3. 启动 Hub（直跑形态：不经 supervisor，start-sync 前台运行 hub 本体。
    #    --host/--port 直接生效；PPID 看门狗保证本脚本死亡时 hub 自杀）
    e2e_log_section "启动 Hub"

    bun run "${MOBI_ROOT}/packages/cli/src/index.ts" --profile "${PROFILE_NAME}" \
        hub start-sync --host 127.0.0.1 --port "${HUB_PORT}" &>"${E2E_TMPDIR}/logs/hub.log" &
    HUB_PID="${!}"
    e2e_log_info "Hub 进程已启动 (PID: ${HUB_PID})"

    # 4. 等待 Hub 就绪
    e2e_log_info "等待 Hub 就绪..."
    if ! wait_for_url "${HUB_HEALTH_URL}" "Hub"; then
        e2e_log_error "Hub 启动失败，日志内容："
        cat "${E2E_TMPDIR}/logs/hub.log" 2>/dev/null || true
        cleanup
        exit 1
    fi
    e2e_log_info "Hub 已就绪 ✓"

    # 5. 启动 Web Dev Server
    e2e_log_section "启动 Web Dev Server"

    (
        cd "${MOBI_ROOT}/packages/web" && \
        bun run dev --profile "${PROFILE_NAME}" &>"${E2E_TMPDIR}/logs/web.log"
    ) &
    WEB_PID="${!}"
    disown
    e2e_log_info "Web Dev Server 进程已启动 (PID: ${WEB_PID})"

    # 6. 等待 Web 就绪
    e2e_log_info "等待 Web Dev Server 就绪..."
    if ! wait_for_url "${WEB_HEALTH_URL}" "Web Dev Server"; then
        e2e_log_error "Web Dev Server 启动失败，日志内容："
        cat "${E2E_TMPDIR}/logs/web.log" 2>/dev/null || true
        cleanup
        exit 1
    fi
    e2e_log_info "Web Dev Server 已就绪 ✓"

    # 7. 启动 Runner（直跑形态同 Hub：后台运行 start-sync，就绪以 state file 为准）
    e2e_log_section "启动 Runner"

    bun run "${MOBI_ROOT}/packages/cli/src/index.ts" --profile "${PROFILE_NAME}" \
        runner start-sync &>"${E2E_TMPDIR}/logs/runner.log" &
    RUNNER_BG_PID="${!}"

    e2e_log_info "等待 Runner 就绪..."
    local runner_waited=0
    local runner_ready=false
    while (( runner_waited < MAX_RUNNER_WAIT_SECONDS * 2 )); do
        if e2e_read_runner_state "${RUNNER_STATE_FILE}" && \
           [[ -n "${RUNNER_PID}" ]] && kill -0 "${RUNNER_PID}" 2>/dev/null; then
            runner_ready=true
            break
        fi
        sleep "${POLL_INTERVAL}"
        runner_waited=$((runner_waited + 1))
    done

    if [[ "${runner_ready}" == false ]]; then
        e2e_log_error "Runner 启动失败，日志内容："
        cat "${E2E_TMPDIR}/logs/runner.log" 2>/dev/null || true
        cleanup
        exit 1
    fi
    e2e_log_info "Runner 已就绪 ✓ (PID: ${RUNNER_PID})"

    # 8. 输出服务信息
    e2e_log_section "E2E 测试环境就绪"
    # 写就绪信号文件（Claude 轮询此文件判断就绪，不依赖 stdout echo——stdout 在后台任务会被 tail 缓冲）
    touch "${E2E_TMPDIR}/ready.flag"
    echo -e "  ${BOLD}Hub${RESET}:          http://localhost:${HUB_PORT}"
    echo -e "  ${BOLD}Hub 健康检查${RESET}:  ${HUB_HEALTH_URL}"
    echo -e "  ${BOLD}Web${RESET}:          http://localhost:${WEB_PORT}"
    echo -e "  ${BOLD}Runner${RESET}:        PID ${RUNNER_PID}"
    echo -e "  ${BOLD}数据目录${RESET}:     ${E2E_TMPDIR}"
    echo ""
    e2e_log_info "按 Ctrl+C 停止所有服务并清理"

    wait
}

main "$@"
