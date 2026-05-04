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

/** Diff 行类型（来自 diffLines） */
type DiffLine = { value: string; added?: boolean; removed?: boolean }

/** 统计非空行数（移除所有空行） */
function countNonEmptyLines(s: string): number {
    return s.split('\n').filter(l => l !== '').length
}

/** 从 diffLines 结果计算统计信息（O(n) 复杂度） */
export function calculateDiffStatsFromLines(diffLines: DiffLine[]): DiffStats {
    let added = 0
    let removed = 0
    let unchanged = 0

    for (const line of diffLines) {
        const count = countNonEmptyLines(line.value)
        if (line.added) {
            added += count
        } else if (line.removed) {
            removed += count
        } else {
            unchanged += count
        }
    }

    return { added, removed, unchanged }
}

/** 格式化行范围统计标签 */
export function formatLineRangeStats(offset: number | null, lineCount: number): string | null {
    if (lineCount <= 0) return null
    if (offset !== null) {
        return `L${offset + 1}-${offset + lineCount} · ${lineCount} lines`
    }
    return `${lineCount} lines`
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
