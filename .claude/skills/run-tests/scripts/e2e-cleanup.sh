#!/usr/bin/env bash
# E2E 测试环境清理脚本
# 1. mobi doctor clean 清理注册进程
# 2. Runner 优雅停止
# 3. 端口兜底清理（始终执行，防止 doctor clean 遗漏子进程）
# 4. 清理数据目录

set -euo pipefail

readonly PROFILE_NAME="e2e"

# shellcheck source=e2e-common.sh
source "$(dirname "$0")/e2e-common.sh"

e2e_load_profile "${PROFILE_NAME}"

# 按端口查找并终止所有占用进程
cleanup_port() {
    local port=$1
    local pids
    pids=$(lsof -iTCP:"${port}" -sTCP:LISTEN -t 2>/dev/null || true)
    local count=0
    for pid in ${pids}; do
        e2e_log_info "终止端口 ${port} 进程 (PID: ${pid})"
        kill -9 "${pid}" 2>/dev/null || true
        count=$((count + 1))
    done
    return ${count}
}

# ─── 主流程 ───────────────────────────────────────────────────────────────────
main() {
    e2e_log_section "Mobi E2E 测试环境清理 (profile: ${PROFILE_NAME})"

    # 1. 使用 mobi doctor clean e2e 清理注册过的进程
    e2e_log_info "清理 profile ${PROFILE_NAME} 的注册进程..."
    local cli_dir
    cli_dir="$(cd "$(dirname "$0")/../../../../packages/cli" && pwd)"
    if (cd "${cli_dir}" && bun run src/index.ts --profile e2e doctor clean e2e 2>&1); then
        e2e_log_info "注册进程清理完成"
    else
        e2e_log_warn "mobi doctor clean 执行失败"
    fi

    # 2. 停止 Runner（通过状态文件）
    e2e_stop_runner "${RUNNER_STATE_FILE}"

    # 3. 端口兜底清理（始终执行，防止 doctor clean 遗漏子进程）
    e2e_log_info "端口兜底清理..."
    local cleaned=0
    # 读 runner control server 端口（动态分配，doctor clean 可能遗漏）
    local control_port=""
    if e2e_read_runner_state "${RUNNER_STATE_FILE}" 2>/dev/null && [[ -n "${RUNNER_HTTP_PORT}" ]]; then
        control_port="${RUNNER_HTTP_PORT}"
    fi
    for port in "${HUB_PORT}" "${WEB_PORT}" ${control_port}; do
        local pids
        pids=$(lsof -iTCP:"${port}" -sTCP:LISTEN -t 2>/dev/null || true)
        for pid in ${pids}; do
            e2e_log_info "终止端口 ${port} 残留进程 (PID: ${pid})"
            kill -9 "${pid}" 2>/dev/null || true
            cleaned=$((cleaned + 1))
        done
    done

    if [[ ${cleaned} -gt 0 ]]; then
        e2e_log_info "清理了 ${cleaned} 个残留进程"
        # 等待端口释放
        sleep 1
        for port in "${HUB_PORT}" "${WEB_PORT}"; do
            local remaining
            remaining=$(lsof -iTCP:"${port}" -sTCP:LISTEN -t 2>/dev/null || true)
            if [[ -n "${remaining}" ]]; then
                e2e_log_warn "端口 ${port} 仍被占用: ${remaining}，尝试强制终止..."
                for pid in ${remaining}; do
                    kill -9 "${pid}" 2>/dev/null || true
                done
            fi
        done
    else
        e2e_log_info "端口无残留进程"
    fi

    # 3.5 pattern 兜底：清所有 --profile e2e 进程（旧残留/僵尸，端口清理可能遗漏）
    # 端口清理只杀占 2224/5175 的进程，但历史残留的 e2e 进程（如上次未清干净）
    # 可能占着别的端口或处于僵尸态，下次 bootstrap 时干扰。按命令行 pattern 彻底清。
    e2e_log_info "pattern 兜底清理（所有 --profile e2e 进程）..."
    local e2e_pids
    e2e_pids=$(pgrep -f -- '--profile e2e' 2>/dev/null || true)
    if [[ -n "${e2e_pids}" ]]; then
        for pid in ${e2e_pids}; do
            e2e_log_info "终止 e2e 残留进程 (PID: ${pid})"
            kill -9 "${pid}" 2>/dev/null || true
        done
        sleep 1
        # 二次确认
        local remaining_e2e
        remaining_e2e=$(pgrep -f -- '--profile e2e' 2>/dev/null || true)
        if [[ -n "${remaining_e2e}" ]]; then
            e2e_log_warn "仍有 e2e 残留: ${remaining_e2e}"
        fi
    else
        e2e_log_info "无 --profile e2e 残留进程"
    fi

    # 4. 清理数据目录（含日志）
    if [[ -d "${E2E_TMPDIR}" ]]; then
        e2e_log_info "清理数据目录: ${E2E_TMPDIR}"
        rm -rf "${E2E_TMPDIR}"
    else
        e2e_log_info "数据目录不存在: ${E2E_TMPDIR}"
    fi

    e2e_log_info "清理完成 ✓"
}

main "$@"
