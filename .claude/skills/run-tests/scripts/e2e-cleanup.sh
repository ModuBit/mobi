#!/usr/bin/env bash
# E2E 测试环境清理脚本
# 使用 mobi doctor clean --profile e2e 清理进程，然后清理数据目录

set -euo pipefail

readonly PROFILE_NAME="e2e"

# shellcheck source=e2e-common.sh
source "$(dirname "$0")/e2e-common.sh"

e2e_load_profile "${PROFILE_NAME}"

# ─── 主流程 ───────────────────────────────────────────────────────────────────
main() {
    e2e_log_section "Mobi E2E 测试环境清理 (profile: ${PROFILE_NAME})"

    # 1. 使用 mobi doctor clean e2e 清理所有关联进程
    e2e_log_info "清理 profile ${PROFILE_NAME} 的所有进程..."
    local cli_dir
    cli_dir="$(cd "$(dirname "$0")/../../../../packages/cli" && pwd)"
    if (cd "${cli_dir}" && bun run src/index.ts --profile e2e doctor clean e2e 2>&1); then
        e2e_log_info "进程清理完成"
    else
        e2e_log_warn "mobi doctor clean 执行失败，尝试端口清理兜底"
        # 兜底：按端口查找并终止
        for port in "${HUB_PORT}" "${WEB_PORT}"; do
            local pids
            pids=$(lsof -iTCP:"${port}" -sTCP:LISTEN -t 2>/dev/null || true)
            for pid in ${pids}; do
                e2e_log_info "终止端口 ${port} 进程 (PID: ${pid})"
                kill -9 "${pid}" 2>/dev/null || true
            done
        done
    fi

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
