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
 * structuredPatch → 渲染行 的纯解析函数
 *
 * Claude Code 的 structuredPatch.lines 为 unified diff 行体：前缀字符（' ' context /
 * '-' 删除 / '+' 新增）+ 原行内容，前缀后无分隔空格（已对照真实文件实证）；
 * 空行的 context 行退化为单个空格（甚至空串）。
 */
import type { StructuredPatch } from '@/domain/chat/types'

/** 解析后的渲染行（与 DiffView 内部行模型对齐，渲染器无需感知数据来源） */
export type PatchRow = {
    value: string
    added?: boolean
    removed?: boolean
    /** context/added 行为 new 文件行号；removed 行为 old 文件行号 */
    lineNum?: number
}

/**
 * 把一组 structuredPatch 解析为带真实文件行号的渲染行。
 * 各 patch 独立起算行号（oldStart/newStart），顺序拼接——MultiEdit 的
 * patch 数组按编辑顺序天然对齐。
 */
export function parseStructuredPatchRows(
    patches: Array<Pick<StructuredPatch, 'oldStart' | 'newStart' | 'lines'>>,
): PatchRow[] {
    const rows: PatchRow[] = []
    for (const patch of patches) {
        let oldNum = patch.oldStart
        let newNum = patch.newStart
        for (const raw of patch.lines) {
            const prefix = raw.charAt(0)
            const value = raw.slice(1)
            if (prefix === '+') {
                rows.push({ value, added: true, lineNum: newNum })
                newNum += 1
            } else if (prefix === '-') {
                rows.push({ value, removed: true, lineNum: oldNum })
                oldNum += 1
            } else {
                // context：old/new 行号同步推进，展示 new 文件行号
                rows.push({ value, lineNum: newNum })
                oldNum += 1
                newNum += 1
            }
        }
    }
    return rows
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
