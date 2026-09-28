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
 * codemirrorDiff 纯函数单测：双栏行号推导（beforeLineOf / oldLineNumbers）与
 * 未变更区折叠区间推导（computeUnchangedRanges）。这些是 diff 渲染的脆弱边界，
 * DOM/widget 机制不在此测（jsdom 下无意义，靠 E2E 兜）。
 */

import { describe, expect, it } from 'vitest'
import { beforeLineOf, oldLineNumbers } from '@/components/review/codemirrorDiff/chunkLineNumbers'
import { computeUnchangedRanges } from '@/components/review/codemirrorDiff/unchangedCollapse'

describe('beforeLineOf（偏移 → 旧文件行号）', () => {
    const text = 'aaa\nbbb\nccc'

    it('首行偏移与跨行偏移', () => {
        expect(beforeLineOf(text, 0)).toBe(1)
        expect(beforeLineOf(text, 4)).toBe(2)
        expect(beforeLineOf(text, 8)).toBe(3)
    })

    it('恰好落在换行符上算前一行（ exclusive 上界语义）', () => {
        expect(beforeLineOf(text, 3)).toBe(1)
        expect(beforeLineOf(text, 7)).toBe(2)
    })

    it('越界钳制到末行', () => {
        expect(beforeLineOf(text, 999)).toBe(3)
        expect(beforeLineOf('', 0)).toBe(1)
    })
})

describe('oldLineNumbers（chunk A 侧跨度 → 旧行号候选）', () => {
    const text = 'l1\nl2\nl3\nl4'

    it('单行与多行跨度', () => {
        expect(oldLineNumbers(text, 0, 2)).toEqual([1])
        expect(oldLineNumbers(text, 0, 6)).toEqual([1, 2])
        expect(oldLineNumbers(text, 9, 11)).toEqual([4])
    })

    it('纯插入跨度（fromA ≥ toA）返回空，调用方跳过', () => {
        expect(oldLineNumbers(text, 3, 3)).toEqual([])
        expect(oldLineNumbers(text, 5, 2)).toEqual([])
    })

    it('末行无换行符的文件', () => {
        expect(oldLineNumbers('no-trailing-newline', 0, 18)).toEqual([1])
    })
})

describe('computeUnchangedRanges（折叠区间推导）', () => {
    // 1-based 行号语义；span = chunk 的 B 侧行跨度

    it('无 chunk：整篇折叠（若够 minSize）', () => {
        expect(computeUnchangedRanges([], 20)).toEqual([{ fromLine: 1, toLine: 20 }])
        expect(computeUnchangedRanges([], 4)).toEqual([]) // 不足 minSize 不折叠
    })

    it('首 chunk 前不留上下文，chunk 后留 margin、尾部到文档末行', () => {
        // chunk 占 1–10；chunk 后留 margin 3 → 13..30
        expect(computeUnchangedRanges([{ from: 1, to: 10 }], 30))
            .toEqual([{ fromLine: 13, toLine: 30 }])
    })

    it('相邻 chunk 之间各留 margin 3 行上下文', () => {
        // chunk1: 5–10，chunk2: 30–35 → gap 11..29 减两侧 margin 3 → 13..26
        // 尾部 38..40 仅 3 行 < minSize 不产
        expect(computeUnchangedRanges([{ from: 5, to: 10 }, { from: 30, to: 35 }], 40))
            .toEqual([{ fromLine: 13, toLine: 26 }])
    })

    it('间隙不足 minSize 的不产出', () => {
        // chunk1: 1–10，chunk2: 16–20 → gap 11..15 − margin×2 = 13（1 行）→ 无折叠
        expect(computeUnchangedRanges([{ from: 1, to: 10 }, { from: 16, to: 20 }], 25))
            .toEqual([])
    })

    it('恰好等于 minSize（5 行）产出闭区间', () => {
        // chunk 到 34，尾部 margin 后 37..41 恰 5 行
        expect(computeUnchangedRanges([{ from: 1, to: 34 }], 41))
            .toEqual([{ fromLine: 37, toLine: 41 }])
    })
})
