#!/usr/bin/env bash
# E2E 测试环境清理脚本
# 查找并终止 Mobi E2E 相关进程，清理临时数据目录

set -euo pipefail

# ─── 配置 ────────────────────────────────────────────────────────────────────
readonly E2E_TMPDIR="/tmp/mobi-e2e-test"
readonly HUB_PORT=2222
readonly WEB_PORT=5173

# ─── 颜色 ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

# ─── 辅助函数 ─────────────────────────────────────────────────────────────────
log_info()    { echo -e "${GREEN}[INFO]${RESET}  $*"; }
log_warn()    { echo -e "${YELLOW}[WARN]${RESET}  $*"; }
log_error()   { echo -e "${RED}[ERROR]${RESET} $*"; }
log_section() { echo -e "\n${BOLD}${CYAN}=== $* ===${RESET}"; }

# 终止占用指定端口的进程
kill_port() {
    local port=$1
    local name=$2
    local pids

    pids=$(lsof -iTCP:"${port}" -sTCP:LISTEN -t 2>/dev/null || true)

    if [[ -z "${pids}" ]]; then
        log_info "端口 ${port}（${name}）无占用进程"
        return 0
    fi

    for pid in ${pids}; do
        local cmd
        cmd=$(ps -p "${pid}" -o comm= 2>/dev/null || echo "unknown")
        log_info "终止 ${name} 进程: PID=${pid} (${cmd})"
        kill -TERM "${pid}" 2>/dev/null || true
    done

    # 等待进程退出（最多 5 秒）
    local waited=0
    while (( waited < 5 )); do
        local still_running=false
        for pid in ${pids}; do
            if kill -0 "${pid}" 2>/dev/null; then
                still_running=true
                break
            fi
        done
        if [[ "${still_running}" == false ]]; then
            return 0
        fi
        sleep 1
        waited=$((waited + 1))
    done

    # 超时后强制终止
    log_warn "进程未在 5s 内退出，强制终止"
    for pid in ${pids}; do
        kill -9 "${pid}" 2>/dev/null || true
    done
}

# ─── 主流程 ───────────────────────────────────────────────────────────────────
main() {
    log_section "Mobi E2E 测试环境清理"

    local cleaned=false

    # 1. 终止 Hub 进程
    log_info "查找 Hub 进程（端口 ${HUB_PORT}）..."
    kill_port "${HUB_PORT}" "Hub"
    cleaned=true

    # 2. 终止 Web Dev Server 进程
    log_info "查找 Web Dev Server 进程（端口 ${WEB_PORT}）..."
    kill_port "${WEB_PORT}" "Web Dev Server"
    cleaned=true

    # 3. 清理临时数据目录
    if [[ -d "${E2E_TMPDIR}" ]]; then
        log_info "清理临时数据目录: ${E2E_TMPDIR}"
        rm -rf "${E2E_TMPDIR}"
        cleaned=true
    else
        log_info "临时数据目录不存在: ${E2E_TMPDIR}"
    fi

    # 4. 清理日志文件
    local log_files=(
        "/tmp/mobi-e2e-hub.log"
        "/tmp/mobi-e2e-web.log"
    )
    for f in "${log_files[@]}"; do
        if [[ -f "${f}" ]]; then
            log_info "清理日志文件: ${f}"
            rm -f "${f}"
            cleaned=true
        fi
    done

    # 5. 输出结果
    if [[ "${cleaned}" == true ]]; then
        log_info "清理完成 ✓"
    else
        log_warn "未发现需要清理的资源"
    fi
}

main "$@"
