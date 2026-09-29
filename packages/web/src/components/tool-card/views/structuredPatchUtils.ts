/*
 * Copyright Maner·Fan
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * structuredPatch → unified patch 文本 的纯合成函数（工具卡 diff 换 @pierre/diffs 渲染核）
 *
 * Claude Code 的 structuredPatch.lines 为 unified diff 行体：前缀字符（' ' context /
 * '-' 删除 / '+' 新增）+ 原行内容，前缀后无分隔空格（已对照真实文件实证）；
 * 空行的 context 行退化为单个空格（甚至空串）。
 *
 * 库 parser（parsePatchFiles）硬要求 `--- / +++` 文件头：缺失时整段文本被当作
 * patch metadata、files 为空（PoC 实证）——合成必须带头，name 仅为占位
 * （消费方 disableFileHeader 不渲染）。
 */
import type { StructuredPatch } from '@/domain/chat/types'

/** 回退路径的渲染行（diffLines(old, new) 的输出行模型） */
export type PatchRowInput = {
    value: string
    added?: boolean
    removed?: boolean
}

/**
 * 把 structuredPatch 数组（MultiEdit 为多条编辑、其余为单条）合成为单个文件的
 * unified patch 文本。各 hunk 按数组顺序拼接（与编辑顺序天然对齐）。
 */
export function composePatchText(name: string, patches: StructuredPatch[]): string {
    const hunks = patches.map((p) => {
        const header = `@@ -${p.oldStart},${p.oldLines} +${p.newStart},${p.newLines} @@`
        return [header, ...p.lines].join('\n')
    })
    return [`--- a/${name}`, `+++ b/${name}`, ...hunks].join('\n')
}

/**
 * 回退合成（无 structuredPatch 时：执行中预览 / Write 无 patch / 历史消息缺数据）：
 * diffLines 行模型 → 单 hunk patch 文本。行号是片段相对行号（从 1 起算），
 * 空 old（Write 新建）落 git 新文件惯例 `@@ -0,0 +1,N @@`。
 */
export function composePatchFromLineRows(name: string, rows: PatchRowInput[]): string {
    let oldCount = 0
    let newCount = 0
    const lines: string[] = []
    for (const row of rows) {
        if (row.added) {
            newCount += 1
            lines.push(`+${row.value}`)
        } else if (row.removed) {
            oldCount += 1
            lines.push(`-${row.value}`)
        } else {
            oldCount += 1
            newCount += 1
            lines.push(` ${row.value}`)
        }
    }
    if (lines.length === 0) return ''
    const hunk: StructuredPatch = {
        oldStart: oldCount > 0 ? 1 : 0,
        oldLines: oldCount,
        newStart: newCount > 0 ? 1 : 0,
        newLines: newCount,
        lines,
    }
    return composePatchText(name, [hunk])
}

/** structuredPatch 行数统计（'+' 计 added、'-' 计 removed；形状不符的行跳过） */
export function countPatchLines(patches: StructuredPatch[]): { added: number; removed: number } {
    let added = 0
    let removed = 0
    for (const patch of patches) {
        for (const line of patch.lines) {
            if (line.startsWith('+')) added += 1
            else if (line.startsWith('-')) removed += 1
        }
    }
    return { added, removed }
}

/** MultiEdit 的 structuredPatch 数组按编辑顺序与 input.edits 对齐：取第 idx 条编辑的 patch
 * （单元素数组形态，DiffView 的 structuredPatches 入参），越界/缺失返回 undefined */
export function patchForEdit(
    patches: StructuredPatch[] | undefined,
    idx: number,
): StructuredPatch[] | undefined {
    const patch = patches?.[idx]
    return patch ? [patch] : undefined
}
