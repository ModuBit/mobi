#!/usr/bin/env bash
# E2E 测试环境清理脚本
# 查找并终止 Mobi E2E 相关进程，清理临时数据目录
# 通过 e2e profile 获取端口和数据目录配置

set -euo pipefail

# ─── 配置（从 e2e profile 读取） ────────────────────────────────────────────
readonly PROFILE_NAME="e2e"
readonly PROFILE_FILE="${HOME}/.mobi/profiles/${PROFILE_NAME}.env"

if [[ -f "${PROFILE_FILE}" ]]; then
    readonly HUB_PORT=$(grep -E '^MOBI_LISTEN_PORT=' "${PROFILE_FILE}" | head -1 | cut -d= -f2 | xargs)
    readonly WEB_PORT=$(grep -E '^MOBI_WEB_PORT=' "${PROFILE_FILE}" | head -1 | cut -d= -f2 | xargs)
    readonly E2E_TMPDIR=$(grep -E '^MOBI_HOME=' "${PROFILE_FILE}" | head -1 | cut -d= -f2 | xargs)
else
    readonly HUB_PORT=2224
    readonly WEB_PORT=5175
    readonly E2E_TMPDIR="/tmp/mobi-e2e-test"
fi

readonly RUNNER_STATE_FILE="${E2E_TMPDIR}/runner.state.json"

# ─── 颜色 ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

# ─── 引入共享函数 ─────────────────────────────────────────────────────────────
# shellcheck source=e2e-common.sh
source "$(dirname "$0")/e2e-common.sh"

# ─── 辅助函数 ─────────────────────────────────────────────────────────────────
# 终止占用指定端口的进程
kill_port() {
    local port=$1
    local name=$2
    local pids

    pids=$(lsof -iTCP:"${port}" -sTCP:LISTEN -t 2>/dev/null || true)

    if [[ -z "${pids}" ]]; then
        e2e_log_info "端口 ${port}（${name}）无占用进程"
        return 0
    fi

    for pid in ${pids}; do
        local cmd
        cmd=$(ps -p "${pid}" -o comm= 2>/dev/null || echo "unknown")
        e2e_log_info "终止 ${name} 进程: PID=${pid} (${cmd})"
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
    e2e_log_warn "进程未在 5s 内退出，强制终止"
    for pid in ${pids}; do
        kill -9 "${pid}" 2>/dev/null || true
    done
}

# ─── 主流程 ───────────────────────────────────────────────────────────────────
main() {
    e2e_log_section "Mobi E2E 测试环境清理 (profile: ${PROFILE_NAME})"

    local cleaned=false

    # 1. 并行终止 Hub、Web、Runner 进程
    e2e_log_info "查找并终止 Hub（端口 ${HUB_PORT}）、Web（端口 ${WEB_PORT}）、Runner..."
    kill_port "${HUB_PORT}" "Hub" &
    kill_port "${WEB_PORT}" "Web Dev Server" &
    e2e_stop_runner "${RUNNER_STATE_FILE}" &
    wait
    cleaned=true

    # 4. 清理临时数据目录
    if [[ -d "${E2E_TMPDIR}" ]]; then
        e2e_log_info "清理临时数据目录: ${E2E_TMPDIR}"
        rm -rf "${E2E_TMPDIR}"
        cleaned=true
    else
        e2e_log_info "临时数据目录不存在: ${E2E_TMPDIR}"
    fi

    # 5. 清理日志文件
    local log_files=(
        "/tmp/mobi-e2e-hub.log"
        "/tmp/mobi-e2e-web.log"
        "/tmp/mobi-e2e-runner.log"
    )
    for f in "${log_files[@]}"; do
        if [[ -f "${f}" ]]; then
            e2e_log_info "清理日志文件: ${f}"
            rm -f "${f}"
            cleaned=true
        fi
    done

    # 6. 输出结果
    if [[ "${cleaned}" == true ]]; then
        e2e_log_info "清理完成 ✓"
    else
        e2e_log_warn "未发现需要清理的资源"
    fi
}

main "$@"
