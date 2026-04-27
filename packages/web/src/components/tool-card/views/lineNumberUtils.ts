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
 * 行号相关工具函数
 */

/** 最小行号列宽度 */
const MIN_LINE_NUM_WIDTH = 40
/** 等宽字体中每个数字的宽度 */
const DIGIT_WIDTH = 8
/** 行号列左右 padding 总和 */
const LINE_NUM_PADDING = 16

/** 计算行号列宽度（根据最大行号） */
export function calculateLineNumWidth(maxLineNum: number): number {
    const digits = String(maxLineNum).length
    return Math.max(MIN_LINE_NUM_WIDTH, digits * DIGIT_WIDTH + LINE_NUM_PADDING)
}

/** 计算数组中的最大行号（避免栈溢出） */
export function getMaxLineNum(lines: Array<{ lineNum?: number } | null | undefined>): number {
    if (lines.length === 0) return 1
    const max = lines.reduce((m, l) => Math.max(m, l?.lineNum ?? 0), 0)
    return max > 0 ? max : 1
}

/** Diff 统计信息 */
export type DiffStats = {
    added: number
    removed: number
    unchanged: number
}

/** 计算 diff 统计信息（精确版本） */
export function calculateDiffStats(oldString: string, newString: string): DiffStats {
    const oldLines = oldString.split('\n')
    const newLines = newString.split('\n')

    // 移除末尾空行
    while (oldLines.length > 0 && oldLines[oldLines.length - 1] === '') {
        oldLines.pop()
    }
    while (newLines.length > 0 && newLines[newLines.length - 1] === '') {
        newLines.pop()
    }

    // 使用简单的 diff 算法计算添加和删除的行数
    let added = 0
    let removed = 0
    let unchanged = 0

    let oldIdx = 0
    let newIdx = 0

    while (oldIdx < oldLines.length || newIdx < newLines.length) {
        if (oldIdx < oldLines.length && newIdx < newLines.length) {
            if (oldLines[oldIdx] === newLines[newIdx]) {
                unchanged++
                oldIdx++
                newIdx++
            } else {
                // 查找在 old 中是否有匹配
                const matchInOld = newLines.slice(newIdx).findIndex(l => l === oldLines[oldIdx])
                const matchInNew = oldLines.slice(oldIdx).findIndex(l => l === newLines[newIdx])

                if (matchInOld === -1 && matchInNew >= 0) {
                    // new 中这行在 old 中找不到匹配，作为添加
                    added++
                    newIdx++
                } else if (matchInNew === -1 && matchInOld >= 0) {
                    // old 中这行在 new 中找不到匹配，作为删除
                    removed++
                    oldIdx++
                } else if (matchInOld >= 0 && (matchInNew === -1 || matchInOld <= matchInNew)) {
                    // 先添加 new 中的行
                    added += matchInOld
                    newIdx += matchInOld
                } else if (matchInNew >= 0) {
                    // 先删除 old 中的行
                    removed += matchInNew
                    oldIdx += matchInNew
                } else {
                    // 无法匹配，一个删除一个添加
                    removed++
                    added++
                    oldIdx++
                    newIdx++
                }
            }
        } else if (oldIdx < oldLines.length) {
            removed++
            oldIdx++
        } else {
            added++
            newIdx++
        }
    }

    return { added, removed, unchanged }
}

/** 格式化 diff 统计信息 */
export function formatDiffStats(stats: DiffStats, type: 'edit' | 'write'): string {
    const parts: string[] = []

    if (type === 'write') {
        // Write 工具：显示写入行数
        const total = stats.added + stats.unchanged
        return `wrote ${total} line${total !== 1 ? 's' : ''}`
    }

    // Edit/MultiEdit 工具：显示添加和删除
    if (stats.added > 0) {
        parts.push(`added ${stats.added} line${stats.added !== 1 ? 's' : ''}`)
    }
    if (stats.removed > 0) {
        parts.push(`removed ${stats.removed} line${stats.removed !== 1 ? 's' : ''}`)
    }

    return parts.join(', ') || 'no changes'
}
