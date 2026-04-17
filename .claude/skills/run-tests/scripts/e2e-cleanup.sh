#!/usr/bin/env bash
# E2E 测试环境清理脚本
# 查找并终止 Mobi E2E 相关进程，清理数据目录

set -euo pipefail

readonly PROFILE_NAME="e2e"

# shellcheck source=e2e-common.sh
source "$(dirname "$0")/e2e-common.sh"

e2e_load_profile "${PROFILE_NAME}"

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

    e2e_log_warn "进程未在 5s 内退出，强制终止"
    for pid in ${pids}; do
        kill -9 "${pid}" 2>/dev/null || true
    done
}

# ─── 主流程 ───────────────────────────────────────────────────────────────────
main() {
    e2e_log_section "Mobi E2E 测试环境清理 (profile: ${PROFILE_NAME})"

    # 1. 并行终止 Hub、Web、Runner 进程
    e2e_log_info "查找并终止 Hub（端口 ${HUB_PORT}）、Web（端口 ${WEB_PORT}）、Runner..."
    kill_port "${HUB_PORT}" "Hub" &
    kill_port "${WEB_PORT}" "Web Dev Server" &
    e2e_stop_runner "${RUNNER_STATE_FILE}" &
    wait

    # 2. 清理数据目录（含日志）
    if [[ -d "${E2E_TMPDIR}" ]]; then
        e2e_log_info "清理数据目录: ${E2E_TMPDIR}"
        rm -rf "${E2E_TMPDIR}"
    else
        e2e_log_info "数据目录不存在: ${E2E_TMPDIR}"
    fi

    e2e_log_info "清理完成 ✓"
}

main "$@"
