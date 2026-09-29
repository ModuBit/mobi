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
 * 工具层变更归并规则单源（审查重写 v2 票03 引入；turn-archive B 后仅存内存类，
 * 作 TurnDiffReporter 每轮累积器）：归并规则（before 首次/after 末次/writeCount 累加）、
 * snapshot 形状。
 */

import { describe, expect, it } from 'vitest'
import { ToolChangeJournal } from '@/modules/common/git/toolChangeJournal'

describe('ToolChangeJournal 归并规则', () => {
    it('同 path 三次写入：before 不变、after 取末次显式值、writeCount=3', () => {
        const journal = new ToolChangeJournal()
        journal.record({ path: 'a.ts', beforeContent: 'v0', toolName: 'Edit' })
        journal.record({ path: 'a.ts', beforeContent: 'ignored-should-not-overwrite', afterContent: 'v1', toolName: 'Write' })
        journal.record({ path: 'a.ts', beforeContent: 'ignored-too', afterContent: 'v2', toolName: 'Edit' })

        const entry = journal.get('a.ts')!
        expect(entry.beforeContent).toBe('v0')
        expect(entry.afterContent).toBe('v2')
        expect(entry.writeCount).toBe(3)
        expect(entry.toolNames).toEqual(['Edit', 'Write'])
    })

    it('无 content 占位：afterContent 缺省不覆盖已有末次值，首轮为 null', () => {
        const journal = new ToolChangeJournal()
        journal.record({ path: 'b.ts', beforeContent: 'before', toolName: 'Edit' })
        expect(journal.get('b.ts')!.afterContent).toBeNull()

        journal.record({ path: 'b.ts', beforeContent: 'before2', toolName: 'Edit' })
        expect(journal.get('b.ts')!.afterContent).toBeNull()
        expect(journal.get('b.ts')!.writeCount).toBe(2)
    })

    it('不同 path 互不干扰；listPaths 与 snapshot 形状一致', () => {
        const journal = new ToolChangeJournal()
        journal.record({ path: 'x.ts', beforeContent: null, afterContent: 'x', toolName: 'Write' })
        journal.record({ path: 'y.ts', beforeContent: 'y0', toolName: 'Edit' })

        expect(journal.listPaths().sort()).toEqual(['x.ts', 'y.ts'])
        const snap = journal.snapshot()
        expect(snap.files['x.ts']).toMatchObject({ beforeContent: null, afterContent: 'x', writeCount: 1 })
        expect(snap.files['y.ts']).toMatchObject({ beforeContent: 'y0', afterContent: null, writeCount: 1 })
    })

    it('snapshot 形状稳定：副本隔离（toolNames 拷贝，封口快照不被后续 record 污染）', () => {
        const journal = new ToolChangeJournal()
        journal.record({ path: 'a.ts', beforeContent: 'v0', afterContent: 'v1', toolName: 'Edit' })
        const snap = journal.snapshot()
        journal.record({ path: 'a.ts', beforeContent: null, afterContent: 'v2', toolName: 'Write' })

        expect(snap.files['a.ts']).toMatchObject({ afterContent: 'v1', writeCount: 1, toolNames: ['Edit'] })
        expect(journal.snapshot().files['a.ts']).toMatchObject({ afterContent: 'v2', writeCount: 2, toolNames: ['Edit', 'Write'] })
    })
})
