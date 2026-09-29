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
 * 工具层变更记录（审查重写 v2 票03）：归并规则（before 首次/after 末次/writeCount
 * 累加）、restore 往返、无 content 占位、损坏 JSON 容错、去抖落盘。
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
    PersistentToolChangeJournal,
    ToolChangeJournal,
    getToolChangesPath,
} from '@/modules/common/git/toolChangeJournal'

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

    it('restore 往返：snapshot → JSON.parse → restore 后事实一致；坏形状条目跳过', () => {
        const journal = new ToolChangeJournal()
        journal.record({ path: 'a.ts', beforeContent: 'v0', afterContent: 'v1', toolName: 'Edit' })
        const roundTrip = ToolChangeJournal.restore(JSON.parse(JSON.stringify(journal.snapshot())))
        expect(roundTrip.get('a.ts')).toEqual(journal.get('a.ts'))

        const partial = ToolChangeJournal.restore({
            files: {
                'good.ts': { beforeContent: 'b', afterContent: null, writeCount: 2, toolNames: ['Edit'] },
                'bad.ts': 'not-an-object',
                '': { beforeContent: null, afterContent: null, writeCount: 1, toolNames: [] },
            },
        })
        expect(partial.listPaths()).toEqual(['good.ts'])
        expect(ToolChangeJournal.restore(null).listPaths()).toEqual([])
        expect(ToolChangeJournal.restore({ files: 42 }).listPaths()).toEqual([])
    })
})

describe('PersistentToolChangeJournal（落盘）', () => {
    let dir: string

    beforeAll(async () => {
        dir = await mkdtemp(join(tmpdir(), 'mobi-tool-journal-'))
    })

    afterAll(async () => {
        await rm(dir, { recursive: true, force: true })
    })

    it('record 后 flush 落盘；重新 open 恢复（重启会话语义）', async () => {
        const filePath = getToolChangesPath(dir, 'session-1')
        const first = await PersistentToolChangeJournal.open(filePath)
        first.record({ path: 'a.ts', beforeContent: 'v0', afterContent: 'v1', toolName: 'Edit' })
        await first.flush()

        const raw = JSON.parse(await readFile(filePath, 'utf8'))
        expect(raw.files['a.ts']).toMatchObject({ beforeContent: 'v0', afterContent: 'v1', writeCount: 1 })

        const second = await PersistentToolChangeJournal.open(filePath)
        expect(second.journal.get('a.ts')).toMatchObject({ beforeContent: 'v0', afterContent: 'v1', writeCount: 1 })
        await second.dispose()
    })

    it('损坏 JSON 容错：按空 journal 起步', async () => {
        const filePath = join(dir, 'corrupted.json')
        await writeFile(filePath, '{ not valid json')
        const handle = await PersistentToolChangeJournal.open(filePath)
        expect(handle.journal.listPaths()).toEqual([])
        await handle.dispose()
    })

    it('去抖：record 后未 flush 不落盘，dispose 收口落盘', async () => {
        const filePath = join(dir, 'debounced.json')
        const handle = await PersistentToolChangeJournal.open(filePath, { debounceMs: 30 })
        handle.record({ path: 'd.ts', beforeContent: null, afterContent: 'x', toolName: 'Write' })
        // 去抖窗口内未刷盘（文件尚不存在）
        await expect(readFile(filePath, 'utf8')).rejects.toThrow()
        await handle.dispose()
        const raw = JSON.parse(await readFile(filePath, 'utf8'))
        expect(raw.files['d.ts'].afterContent).toBe('x')
    })

    it('getToolChangesPath：会话子树隔离，非法字符兜底', () => {
        expect(getToolChangesPath('/ws', 'abc-123')).toBe(join('/ws', '.mobi', 'turn-diffs', 'abc-123', 'tool-changes.json'))
        expect(getToolChangesPath('/ws', 'a/b c')).toBe(join('/ws', '.mobi', 'turn-diffs', 'a_b_c', 'tool-changes.json'))
    })
})
