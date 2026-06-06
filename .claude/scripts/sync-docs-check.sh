#!/usr/bin/env bash
# sync-docs 结构性变更检测
# 用于 Stop hook：只在检测到结构性代码变更时输出提醒，否则完全静默
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || exit 0)"
[[ -z "$REPO_ROOT" ]] && exit 0

cd "$REPO_ROOT"

# 获取所有变更的 .ts/.tsx 文件（工作区 + 暂存 + 未跟踪）
changed=$(git diff --name-only HEAD -- '*.ts' '*.tsx' 2>/dev/null)
changed+=$'\n'
changed+=$(git diff --name-only --cached -- '*.ts' '*.tsx' 2>/dev/null)
changed+=$'\n'
changed+=$(git ls-files --others --exclude-standard -- '*.ts' '*.tsx' 2>/dev/null)

# 去重、去空
changed=$(echo "$changed" | sort -u | grep -v '^$' || true)
[[ -z "$changed" ]] && exit 0

# 检查是否有结构性变更
structural=0

# 1. 新增/删除的文件（不跟踪的文件 = 新增）
new_files=$(git ls-files --others --exclude-standard -- '*.ts' '*.tsx' 2>/dev/null || true)
if [[ -n "$new_files" ]]; then
    structural=1
fi

# 2. 已删除的文件
deleted=$(git diff --name-only --diff-filter=D HEAD -- '*.ts' '*.tsx' 2>/dev/null || true)
if [[ -n "$deleted" ]]; then
    structural=1
fi

# 3. 检查 diff 中是否有结构性关键字（仅在尚未判定时检查）
if [[ $structural -eq 0 ]]; then
    # 只检查已跟踪文件的 diff
    tracked_changes=$(git diff --name-only HEAD -- '*.ts' '*.tsx' 2>/dev/null || true)
    if [[ -n "$tracked_changes" ]]; then
        structural_count=$(git diff HEAD -- $tracked_changes 2>/dev/null | grep -cE '^\+.*(export (type|interface|function|class)|Schema\b|CREATE TABLE)' || true)
        if [[ "$structural_count" -gt 0 ]]; then
            structural=1
        fi
    fi
fi

# 4. 检查是否涉及 routes/ rpcGateway socket 目录
if [[ $structural -eq 0 ]]; then
    route_changes=$(echo "$changed" | grep -E '(routes/|rpcGateway|socket/)' || true)
    if [[ -n "$route_changes" ]]; then
        structural=1
    fi
fi

# 非结构性变更，静默退出
[[ $structural -eq 0 ]] && exit 0

# 结构性变更，输出提醒
changed_list=$(echo "$changed" | head -10 | tr '\n' ' ')
echo ""
echo "[sync-docs] 检测到结构性代码变更：$changed_list"
echo "建议执行 /sync-docs 检查并更新受影响的文档。"
echo ""
