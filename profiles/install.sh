#!/usr/bin/env bash
# 将项目 profiles 目录软链接到 ~/.mobi/profiles
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MOBI_HOME="${HOME}/.mobi"
TARGET="${MOBI_HOME}/profiles"

# 确保 ~/.mobi 存在
mkdir -p "${MOBI_HOME}"

# 已存在且指向正确位置
if [ -L "${TARGET}" ] && [ "$(readlink -f "${TARGET}")" = "${SCRIPT_DIR}" ]; then
    echo "已链接: ${TARGET} -> ${SCRIPT_DIR}"
    exit 0
fi

# 已存在但不是软链接（真实目录），备份后替换
if [ -e "${TARGET}" ] && [ ! -L "${TARGET}" ]; then
    BACKUP="${TARGET}.bak.$(date +%Y%m%d%H%M%S)"
    echo "备份已有目录: ${TARGET} -> ${BACKUP}"
    mv "${TARGET}" "${BACKUP}"
fi

# 已存在但指向错误位置，先删除
if [ -L "${TARGET}" ]; then
    echo "更新链接: ${TARGET} -> ${SCRIPT_DIR}"
    rm "${TARGET}"
else
    echo "创建链接: ${TARGET} -> ${SCRIPT_DIR}"
fi

ln -s "${SCRIPT_DIR}" "${TARGET}"
echo "完成: ${TARGET} -> ${SCRIPT_DIR}"
