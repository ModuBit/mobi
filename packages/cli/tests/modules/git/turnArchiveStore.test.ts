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
 * turn 封口归档存储测试（turn-archive B：滚动单条极简化）：文件实现 roundtrip +
 * 容错 + 覆盖语义 + 旧格式兼容 + 内存 fake 一致性。归档只存取不计算——统计逻辑归
 * 消费端测试。断言外部行为（落盘 JSON 形状 / loadLatest 读数）。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
    createInMemoryTurnArchiveStore,
    FileTurnArchiveStore,
    getTurnArchivePath,
    type TurnArchiveRecord,
} from '@/modules/common/git/turnArchiveStore'

const SID = 's-1'

let dir: string

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mobi-archive-'))
})

afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
})

function record(turnIndex: number, files: TurnArchiveRecord['files'], baseTurnIndex: number | null = null): TurnArchiveRecord {
    return { turnIndex, baseTurnIndex, sealedAt: 1_700_000_000_000 + turnIndex, files }
}

function file(overrides: Partial<TurnArchiveRecord['files'][number]> = {}): TurnArchiveRecord['files'][number] {
    return { path: '/p/a.ts', kind: 'modify', additions: 1, deletions: 1, writeCount: 1, toolNames: ['Edit'], patch: '-x\n+y\n', oversizedPatch: false, ...overrides }
}

describe('FileTurnArchiveStore（滚动单条）', () => {
    it('seal 落盘单条：JSON 无 turns 数组、文件记录无全文字段、含 patch', async () => {
        const store = new FileTurnArchiveStore(getTurnArchivePath(dir, SID))
        await store.seal(record(1, [file()]))

        const raw = JSON.parse(await readFile(getTurnArchivePath(dir, SID), 'utf8')) as Record<string, unknown>
        expect(Array.isArray(raw['turns'])).toBe(false)
        expect(raw['turnIndex']).toBe(1)
        const files = raw['files'] as Array<Record<string, unknown>>
        expect(files[0]).not.toHaveProperty('beforeContent')
        expect(files[0]).not.toHaveProperty('afterContent')
        expect(files[0]!['patch']).toContain('+y')
    })

    it('seal → loadLatest/loadTurn roundtrip：滚动单条下只有最新轮可命中', async () => {
        const store = new FileTurnArchiveStore(getTurnArchivePath(dir, SID))
        await store.seal(record(2, [file({ path: '/p/b.ts' })]))
        await store.seal(record(1, [file({ path: '/p/a.ts' })]))

        expect((await store.loadLatest())!.turnIndex).toBe(1)
        expect((await store.loadTurn(1))!.files[0]!.path).toBe('/p/a.ts')
        expect(await store.loadTurn(2)).toBeNull() // 历史轮已被覆盖，不可再查
        expect((await store.listTurns()).map((t) => t.turnIndex)).toEqual([1])
    })

    it('文件不存在 / JSON 损坏 / 单条形状坏：按空归档，不抛；损坏后 seal 恢复', async () => {
        const missing = new FileTurnArchiveStore(join(dir, 'none', 'turn-archive.json'))
        expect(await missing.listTurns()).toEqual([])

        const corruptPath = getTurnArchivePath(dir, SID)
        await mkdir(dirname(corruptPath), { recursive: true })
        await writeFile(corruptPath, '{ not json')
        const corrupt = new FileTurnArchiveStore(corruptPath)
        expect(await corrupt.listTurns()).toEqual([])
        await corrupt.seal(record(1, [file()]))
        expect((await corrupt.loadLatest())!.turnIndex).toBe(1)

        // 新格式顶层形状坏（缺 files 键 / turnIndex 非数字）：同按空归档
        await writeFile(corruptPath, JSON.stringify({ nope: true }))
        expect(await new FileTurnArchiveStore(corruptPath).listTurns()).toEqual([])
    })

    it('旧多轮格式兼容：只认 turns.at(-1)，patch 缺失给空串，遗留全文字段保留（读侧过渡）', async () => {
        const path = getTurnArchivePath(dir, SID)
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, JSON.stringify({
            turns: [
                { turnIndex: 1, baseTurnIndex: null, sealedAt: 1, files: [{ path: '/a.ts', beforeContent: 'old', afterContent: 'new', writeCount: 2, toolNames: ['Edit'], additions: 1, deletions: 1 }] },
                { turnIndex: 2, baseTurnIndex: 1, sealedAt: 2, files: [file({ path: '/b.ts' })] },
            ],
        }))
        const store = new FileTurnArchiveStore(path)

        expect((await store.loadLatest())!.turnIndex).toBe(2)
        expect((await store.loadLatest())!.files[0]!.patch).toContain('+y')
        expect(await store.loadTurn(1)).toBeNull() // 历史轮（含全文）不认

        // 旧轮恰是最新：patch 缺失给空、全文字段保留
        await writeFile(path, JSON.stringify({
            turns: [{ turnIndex: 5, baseTurnIndex: null, sealedAt: 1, files: [{ path: '/a.ts', beforeContent: 'old', afterContent: 'new', writeCount: 2, toolNames: ['Edit'], additions: 1, deletions: 1 }] }],
        }))
        const legacy = await new FileTurnArchiveStore(path).loadLatest()
        expect(legacy!.files[0]!.patch).toBe('')
        expect(legacy!.files[0]!.kind).toBe('modify') // kind 缺失按遗留全文字段判定
        expect(legacy!.files[0]!.beforeContent).toBe('old')
    })

    it('路径约定：.mobi/turn-diffs/<safeId>/turn-archive.json，sessionId 非法字符兜底替换', () => {
        expect(getTurnArchivePath('/ws', 's-1')).toBe(join('/ws', '.mobi', 'turn-diffs', 's-1', 'turn-archive.json'))
        expect(getTurnArchivePath('/ws', 'a/b:c')).toBe(join('/ws', '.mobi', 'turn-diffs', 'a_b_c', 'turn-archive.json'))
    })
})

describe('createInMemoryTurnArchiveStore', () => {
    it('与文件实现同语义：seal 覆盖、只见最新轮、load 缺失 null、返回副本', async () => {
        const store = createInMemoryTurnArchiveStore([record(1, [])])
        await store.seal(record(1, [file({ path: '/p/a.ts' })]))
        await store.seal(record(2, [file({ path: '/p/b.ts' })]))

        expect((await store.listTurns()).map((t) => t.turnIndex)).toEqual([2])
        expect(await store.loadTurn(1)).toBeNull()
        expect(await store.loadTurn(5)).toBeNull()
        // 返回副本：外部改写不污染内部
        ;(await store.loadTurn(2))!.files[0]!.path = '/mutated.ts'
        expect(store.records()[0]!.files[0]!.path).toBe('/p/b.ts')
    })
})
