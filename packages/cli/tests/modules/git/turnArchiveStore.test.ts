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
 * turn 封口归档存储测试（审查 v3 票01）：文件实现 roundtrip + 容错 + 覆盖语义 +
 * 内存 fake 一致性。归档只存取不计算——统计逻辑归消费端测试。
 */

import { describe, it, expect } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
    createInMemoryTurnArchiveStore,
    FileTurnArchiveStore,
    getTurnArchivePath,
    type TurnArchiveRecord,
} from '@/modules/common/git/turnArchiveStore'

const SID = 's-1'

function record(turnIndex: number, files: TurnArchiveRecord['files'], baseTurnIndex: number | null = null): TurnArchiveRecord {
    return { turnIndex, baseTurnIndex, sealedAt: 1_700_000_000_000 + turnIndex, files }
}

describe('FileTurnArchiveStore', () => {
    it('seal → list/load roundtrip，按 turnIndex 升序', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'mobi-archive-'))
        try {
            const store = new FileTurnArchiveStore(getTurnArchivePath(dir, SID))
            await store.seal(record(2, [{ path: '/p/b.ts', beforeContent: null, afterContent: 'b', writeCount: 1, toolNames: ['Write'] }]))
            await store.seal(record(1, [{ path: '/p/a.ts', beforeContent: 'a0', afterContent: 'a1', writeCount: 2, toolNames: ['Edit'] }]))

            const turns = await store.listTurns()
            expect(turns.map((t) => t.turnIndex)).toEqual([1, 2])
            expect((await store.loadTurn(2))!.files[0]!.path).toBe('/p/b.ts')
            expect(await store.loadTurn(9)).toBeNull()
        } finally {
            await rm(dir, { recursive: true, force: true })
        }
    })

    it('同 turnIndex 再封口 = 覆盖（重放语义）', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'mobi-archive-'))
        try {
            const store = new FileTurnArchiveStore(getTurnArchivePath(dir, SID))
            await store.seal(record(1, [{ path: '/p/a.ts', beforeContent: 'x', afterContent: 'y', writeCount: 1, toolNames: ['Edit'] }]))
            await store.seal(record(1, [{ path: '/p/a.ts', beforeContent: 'x', afterContent: 'z', writeCount: 3, toolNames: ['Edit'] }]))

            const turns = await store.listTurns()
            expect(turns).toHaveLength(1)
            expect(turns[0]!.files[0]!.afterContent).toBe('z')
            expect(turns[0]!.files[0]!.writeCount).toBe(3)
        } finally {
            await rm(dir, { recursive: true, force: true })
        }
    })

    it('文件不存在 / JSON 损坏 / 条目形状坏：按空归档或跳过坏条目，不抛', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'mobi-archive-'))
        try {
            const missing = new FileTurnArchiveStore(join(dir, 'none', 'turn-archive.json'))
            expect(await missing.listTurns()).toEqual([])

            const corruptPath = getTurnArchivePath(dir, SID)
            await mkdir(dirname(corruptPath), { recursive: true })
            await writeFile(corruptPath, '{ not json')
            expect(await new FileTurnArchiveStore(corruptPath).listTurns()).toEqual([])

            await writeFile(corruptPath, JSON.stringify({ turns: [{ turnIndex: 'bad' }, { turnIndex: 3 }, { nope: true }, { turnIndex: 4, files: [{ bad: 1 }, { path: '/ok.ts', writeCount: 'x' }] }] }))
            // 缺 files 键的条目视为形状坏跳过（空轮封口是 files: []，不会缺键）
            const turns = await new FileTurnArchiveStore(corruptPath).listTurns()
            expect(turns.map((t) => t.turnIndex)).toEqual([4])
            expect(turns[0]!.files).toEqual([{ path: '/ok.ts', beforeContent: null, afterContent: null, writeCount: 1, toolNames: [], additions: 0, deletions: 0 }])
        } finally {
            await rm(dir, { recursive: true, force: true })
        }
    })

    it('路径约定：.mobi/turn-diffs/<safeId>/turn-archive.json，sessionId 非法字符兜底替换', () => {
        expect(getTurnArchivePath('/ws', 's-1')).toBe(join('/ws', '.mobi', 'turn-diffs', 's-1', 'turn-archive.json'))
        expect(getTurnArchivePath('/ws', 'a/b:c')).toBe(join('/ws', '.mobi', 'turn-diffs', 'a_b_c', 'turn-archive.json'))
    })
})

describe('createInMemoryTurnArchiveStore', () => {
    it('与文件实现同语义：seal 覆盖、list 升序、load 缺失 null、返回副本', async () => {
        const store = createInMemoryTurnArchiveStore([record(1, [])])
        await store.seal(record(1, [{ path: '/p/a.ts', beforeContent: null, afterContent: 'a', writeCount: 1, toolNames: ['Write'] }]))
        await store.seal(record(2, []))

        expect((await store.listTurns()).map((t) => t.turnIndex)).toEqual([1, 2])
        expect((await store.loadTurn(1))!.files[0]!.path).toBe('/p/a.ts')
        expect(await store.loadTurn(5)).toBeNull()
        // 返回副本：外部改写不污染内部
        ;(await store.loadTurn(1))!.files[0]!.path = '/mutated.ts'
        expect((await store.loadTurn(1))!.files[0]!.path).toBe('/p/a.ts')
    })
})
