#!/usr/bin/env bash
# E2E 测试环境引导脚本
# 启动 Hub + Web Dev Server，等待所有服务就绪后保持前台运行
# Ctrl+C 或收到 SIGTERM 时自动清理所有子进程
# 通过 --profile e2e 加载配置

set -euo pipefail

# ─── 配置 ────────────────────────────────────────────────────────────────────
readonly PROFILE_NAME="e2e"
readonly PROFILE_FILE="${HOME}/.mobi/profiles/${PROFILE_NAME}.env"

if [[ ! -f "${PROFILE_FILE}" ]]; then
    echo -e "\033[0;31m[ERROR]\033[0m Profile 文件不存在: ${PROFILE_FILE}"
    echo "请先运行: profiles/install.sh"
    exit 1
fi

# 从 profile 文件提取端口号（仅用于健康检查，服务启动由 --profile 处理）
readonly HUB_PORT=$(grep -E '^MOBI_LISTEN_PORT=' "${PROFILE_FILE}" | head -1 | cut -d= -f2 | xargs)
readonly WEB_PORT=$(grep -E '^MOBI_WEB_PORT=' "${PROFILE_FILE}" | head -1 | cut -d= -f2 | xargs)
readonly E2E_TMPDIR=$(grep -E '^MOBI_HOME=' "${PROFILE_FILE}" | head -1 | cut -d= -f2 | xargs)
readonly HUB_HEALTH_URL="http://localhost:${HUB_PORT}/health"
readonly WEB_HEALTH_URL="http://localhost:${WEB_PORT}"
readonly MAX_WAIT_SECONDS=30
readonly POLL_INTERVAL=0.5

# ─── 颜色 ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

# ─── 全局变量 ─────────────────────────────────────────────────────────────────
# monorepo 根目录（脚本位于 tools/scripts/ 下）
readonly MOBI_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

HUB_PID=""
WEB_PID=""
CLEANUP_DONE=false

# ─── 辅助函数 ─────────────────────────────────────────────────────────────────
log_info()    { echo -e "${GREEN}[INFO]${RESET}  $*"; }
log_warn()    { echo -e "${YELLOW}[WARN]${RESET}  $*"; }
log_error()   { echo -e "${RED}[ERROR]${RESET} $*"; }
log_section() { echo -e "\n${BOLD}${CYAN}=== $* ===${RESET}"; }

# 检查端口是否被占用
check_port() {
    local port=$1
    if lsof -iTCP:"${port}" -sTCP:LISTEN -t &>/dev/null; then
        log_error "端口 ${port} 已被占用，无法启动 E2E 测试环境"
        log_error "占用进程："
        lsof -iTCP:"${port}" -sTCP:LISTEN 2>/dev/null || true
        exit 1
    fi
}

# 轮询等待 URL 可用
wait_for_url() {
    local url=$1
    local name=$2
    local max_attempts=$(( MAX_WAIT_SECONDS * 2 ))  # POLL_INTERVAL=0.5, 所以 ×2
    local attempt=0

    while (( attempt < max_attempts )); do
        if curl -sf --max-time 2 "${url}" &>/dev/null; then
            return 0
        fi
        sleep "${POLL_INTERVAL}"
        attempt=$(( attempt + 1 ))
    done

    log_error "等待 ${name} 就绪超时（${MAX_WAIT_SECONDS}s）"
    return 1
}

# ─── 清理函数 ─────────────────────────────────────────────────────────────────
cleanup() {
    # 防止重复清理
    if [[ "${CLEANUP_DONE}" == true ]]; then
        return 0
    fi
    CLEANUP_DONE=true

    log_section "清理 E2E 测试环境"

    # 终止 Hub 进程
    if [[ -n "${HUB_PID}" ]] && kill -0 "${HUB_PID}" 2>/dev/null; then
        log_info "终止 Hub 进程 (PID: ${HUB_PID})"
        kill -TERM "${HUB_PID}" 2>/dev/null || true
        wait "${HUB_PID}" 2>/dev/null || true
    fi

    # 终止 Web Dev Server 进程
    if [[ -n "${WEB_PID}" ]] && kill -0 "${WEB_PID}" 2>/dev/null; then
        log_info "终止 Web Dev Server 进程 (PID: ${WEB_PID})"
        kill -TERM "${WEB_PID}" 2>/dev/null || true
        wait "${WEB_PID}" 2>/dev/null || true
    fi

    # 清理临时数据目录
    if [[ -d "${E2E_TMPDIR}" ]]; then
        log_info "清理临时数据目录: ${E2E_TMPDIR}"
        rm -rf "${E2E_TMPDIR}"
    fi

    log_info "清理完成"
}

# ─── 信号处理 ─────────────────────────────────────────────────────────────────
trap cleanup SIGINT SIGTERM

# ─── 主流程 ───────────────────────────────────────────────────────────────────
main() {
    log_section "Mobi E2E 测试环境引导 (profile: ${PROFILE_NAME})"

    # 1. 检查端口
    log_info "检查端口占用情况..."
    check_port "${HUB_PORT}"
    check_port "${WEB_PORT}"
    log_info "端口 ${HUB_PORT}（Hub）和 ${WEB_PORT}（Web）均可用"

    # 2. 创建临时数据目录
    log_info "创建临时数据目录: ${E2E_TMPDIR}"
    mkdir -p "${E2E_TMPDIR}"

    # 3. 启动 Hub（通过 CLI 加载 --profile e2e）
    log_section "启动 Hub"

    (
        cd "${MOBI_ROOT}" && \
        bun run packages/cli/src/index.ts --profile "${PROFILE_NAME}" hub &>/tmp/mobi-e2e-hub.log
    ) &
    HUB_PID="${!}"
    disown
    log_info "Hub 进程已启动 (PID: ${HUB_PID})"

    # 4. 等待 Hub 健康检查通过
    log_info "等待 Hub 就绪..."
    if ! wait_for_url "${HUB_HEALTH_URL}" "Hub"; then
        log_error "Hub 启动失败，日志内容："
        cat /tmp/mobi-e2e-hub.log 2>/dev/null || true
        cleanup
        exit 1
    fi
    log_info "Hub 已就绪 ✓"

    # 5. 启动 Web Dev Server（通过 dev.ts 加载 --profile e2e）
    log_section "启动 Web Dev Server"

    (
        cd "${MOBI_ROOT}/packages/web" && \
        bun run dev --profile "${PROFILE_NAME}" &>/tmp/mobi-e2e-web.log
    ) &
    WEB_PID="${!}"
    disown
    log_info "Web Dev Server 进程已启动 (PID: ${WEB_PID})"

    # 6. 等待 Web 就绪
    log_info "等待 Web Dev Server 就绪..."
    if ! wait_for_url "${WEB_HEALTH_URL}" "Web Dev Server"; then
        log_error "Web Dev Server 启动失败，日志内容："
        cat /tmp/mobi-e2e-web.log 2>/dev/null || true
        cleanup
        exit 1
    fi
    log_info "Web Dev Server 已就绪 ✓"

    # 7. 输出服务信息
    log_section "E2E 测试环境就绪"
    echo -e "  ${BOLD}Hub${RESET}:          http://localhost:${HUB_PORT}"
    echo -e "  ${BOLD}Hub 健康检查${RESET}:  ${HUB_HEALTH_URL}"
    echo -e "  ${BOLD}Web${RESET}:          http://localhost:${WEB_PORT}"
    echo -e "  ${BOLD}数据目录${RESET}:     ${E2E_TMPDIR}"
    echo ""
    log_info "按 Ctrl+C 停止所有服务并清理"

    # 8. 前台等待信号
    wait
}

main "$@"
