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
 * reviewEntryFromContents 单测（内容对 → 条目判定单源）：kind 三态 + 行多重集差
 * 计数 + oversized 阈值判据。
 */

import { describe, expect, it } from 'vitest'
import { OVERSIZE_DIFF_LINES } from '@mobi/shared'
import { reviewEntryFromContents } from '@/modules/common/git/reviewEntry'

describe('reviewEntryFromContents（判定单源）', () => {
    it('kind 三态：before null 且 after 有 = add / after null 且 before 有 = delete / 其余 modify', () => {
        expect(reviewEntryFromContents('new.ts', null, 'a\n').kind).toBe('add')
        expect(reviewEntryFromContents('gone.ts', 'a\n', null).kind).toBe('delete')
        expect(reviewEntryFromContents('edit.ts', 'a\n', 'a\nb\n').kind).toBe('modify')
        // 双 null：modify 兜底（采集入口不会产出，判定仍须全 defined）
        expect(reviewEntryFromContents('void.ts', null, null)).toMatchObject({ kind: 'modify', additions: 0, deletions: 0 })
    })

    it('计数 = 行多重集差（重复行保守），尾随换行不计一行', () => {
        // 多重集差：after 多 1 行 c、before 多 1 行 a（重复行 b 两侧各一不计）
        expect(reviewEntryFromContents('f.ts', 'a\nb\n', 'b\nc\n')).toMatchObject({ additions: 1, deletions: 1 })
        // 尾随换行：'a\n' 拆一行，不是两行
        expect(reviewEntryFromContents('f.ts', null, 'a\n')).toMatchObject({ additions: 1, deletions: 0 })
        // 空串 vs null：空串内容面拆零行（尾换行 pop），null = 缺侧（add）
        expect(reviewEntryFromContents('f.ts', '', 'a\n')).toMatchObject({ kind: 'modify', additions: 1, deletions: 0 })
    })

    it('oversized 判据 = additions + deletions > OVERSIZE_DIFF_LINES（与 git 条目同判据）', () => {
        const big = `${'x\n'.repeat(OVERSIZE_DIFF_LINES)}y\n` // 超限 +1
        const entry = reviewEntryFromContents('big.ts', null, big)
        expect(entry.additions).toBe(OVERSIZE_DIFF_LINES + 1)
        expect(entry.oversized).toBe(true)

        const ok = 'x\n'.repeat(OVERSIZE_DIFF_LINES) // 恰好到限
        expect(reviewEntryFromContents('ok.ts', null, ok).oversized).toBe(false)
    })

    it('条目形状：untracked 恒 true（内容层源事实）、binary 恒 false、previousPath null', () => {
        expect(reviewEntryFromContents('f.ts', 'a\n', 'b\n')).toMatchObject({
            path: 'f.ts',
            previousPath: null,
            binary: false,
            untracked: true,
        })
    })
})
