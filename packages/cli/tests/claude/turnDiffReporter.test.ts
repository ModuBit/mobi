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
 * TurnDiffReporter 合成契约：观测序列 → 载荷断言。git 口径用内存 fake store
 * （seam 契约见 turnSnapshotStore.test.ts），投影口径直接喂 RawJSONLines 消息序列。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { RawJSONLines } from '@/claude/types'
import { TURN_DIFF_EVENT, TurnDiffPayloadSchema, type TurnDiffPayload } from '@mobi/shared'
import { TurnDiffReporter, ensureBaselineSnapshot } from '@/claude/turnDiffReporter'
import { createInMemoryTurnSnapshotStore } from '@/modules/common/git/turnSnapshotStore'
import { createInMemoryTurnArchiveStore, FileTurnArchiveStore } from '@/modules/common/git/turnArchiveStore'
import { PersistentToolChangeJournal } from '@/modules/common/git/toolChangeJournal'

// 补读竞态脚本：同 path 多次补读并发时，模拟「R1 慢返回中间态、R2 快返回末次」的
// resolve 乱序（磁盘真实时序 = 调度序）。未命中的 readFile 调用透传 actual。
const readScript = vi.hoisted(() => ({ reads: [] as Array<{ path: string; value: string; delayMs: number; done?: boolean }> }))
vi.mock('node:fs/promises', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:fs/promises')>()
    return {
        ...actual,
        readFile: async (path: string, options?: unknown) => {
            const scripted = readScript.reads.find((r) => r.path === path && !r.done)
            if (!scripted) return actual.readFile(path, options as never)
            scripted.done = true
            await new Promise((resolve) => setTimeout(resolve, scripted.delayMs))
            return scripted.value
        },
    }
})

const SID = 's-1'

beforeEach(() => {
    readScript.reads.length = 0
})

/** 构造 assistant tool_use 消息（RawJSONLines 形态，观测所需的最小字段） */
function assistantToolUse(toolUseId: string, name: string, filePath: string): RawJSONLines {
    return {
        type: 'assistant',
        message: {
            role: 'assistant',
            content: [{ type: 'tool_use', id: toolUseId, name, input: { file_path: filePath } }],
        },
    } as unknown as RawJSONLines
}

/** 构造 user tool_result 消息（带 structuredPatch 行数） */
function userToolResult(toolUseId: string, patchLines: string[]): RawJSONLines {
    return {
        type: 'user',
        message: {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: toolUseId }],
        },
        toolUseResult: { structuredPatch: [{ lines: patchLines }] },
    } as unknown as RawJSONLines
}

function sentPayloads(send: ReturnType<typeof vi.fn>): TurnDiffPayload[] {
    return send.mock.calls.map(([raw]) => {
        const envelope = raw as unknown as { mobiCustomEvent: boolean; role: string; content: Array<{ type: string; name: string; value: TurnDiffPayload }> }
        expect(envelope.mobiCustomEvent).toBe(true)
        expect(envelope.role).toBe('custom')
        const block = envelope.content[0]!
        expect(block.type).toBe('custom-event')
        expect(block.name).toBe(TURN_DIFF_EVENT)
        // 协议边界保险丝的实证：入流载荷必过 schema
        expect(() => TurnDiffPayloadSchema.parse(block.value)).not.toThrow()
        return block.value
    })
}

describe('TurnDiffReporter（git 快照口径）', () => {
    it('result 时以相邻快照 diff 合成：基线 = baseline 快照（链尾 -2），本轮快照入链', async () => {
        const store = createInMemoryTurnSnapshotStore({
            // 会话启动已打 baseline（index 1），本轮 capture 生成 fake-tree-2
            chains: { [SID]: [{ index: 1, tree: 't1' }] },
            trees: {
                t1: { 'a.ts': ['const a = 1'] },
                'fake-tree-2': { 'a.ts': ['const a = 1', 'const b = 2'], 'new.ts': ['x'] },
            },
        })
        const send = vi.fn()
        const reporter = new TurnDiffReporter(SID, store, send)

        reporter.observe(assistantToolUse('t1', 'Edit', '/repo/a.ts'))
        await reporter.onTurnEnd()

        const [payload] = sentPayloads(send)
        expect(payload!.turnIndex).toBe(2)
        expect(payload!.baseTurnIndex).toBe(1)
        expect(payload!.git).toEqual({ baseTree: 't1', headTree: 'fake-tree-2' })
        expect(payload!.stats).toEqual({ files: 2, additions: 2, deletions: 0 })
        expect(payload!.files.map((f) => f.path)).toEqual(['a.ts', 'new.ts'])
        // 快照已入链
        expect(await store.listChain(SID)).toHaveLength(2)
    })

    it('链空（baseline 缺失）：本轮退投影口径，快照照打供后续轮次续链——不裹挟历史未提交变更', async () => {
        // 工作区里预置「历史」改动语义：链空无 baseline，HEAD 兜底已删，不产出 git 口径
        const store = createInMemoryTurnSnapshotStore()
        const send = vi.fn()
        const reporter = new TurnDiffReporter(SID, store, send)

        reporter.observe(assistantToolUse('t1', 'Edit', '/repo/a.ts'))
        await reporter.onTurnEnd()

        expect(await store.listChain(SID)).toHaveLength(1) // 快照照打
        const [payload] = sentPayloads(send)
        expect(payload!.git).toBeNull()
        expect(payload!.baseTurnIndex).toBeNull()
    })

    it('本轮无文件变化：不出卡（不合成空消息）', async () => {
        const store = createInMemoryTurnSnapshotStore()
        const send = vi.fn()
        const reporter = new TurnDiffReporter(SID, store, send)
        await reporter.onTurnEnd()
        expect(send).not.toHaveBeenCalled()
    })

    it('store 合成失败：吞错不抛出（turn 完成不受阻），turn 状态照常重置', async () => {
        const store = createInMemoryTurnSnapshotStore()
        const broken = {
            capture: store.capture.bind(store),
            listChain: store.listChain.bind(store),
            lastTurnDiff: async () => { throw new Error('git exploded') },
            diffTrees: store.diffTrees.bind(store),
            clearSession: store.clearSession.bind(store),
        }
        const send = vi.fn()
        const reporter = new TurnDiffReporter(SID, broken, send)
        await expect(reporter.onTurnEnd()).resolves.toBeUndefined()
        expect(send).not.toHaveBeenCalled()
    })

    it('空仓库首轮：无上一轮，降级投影口径，快照照打', async () => {
        const store = createInMemoryTurnSnapshotStore()
        const send = vi.fn()
        const reporter = new TurnDiffReporter(SID, store, send)
        reporter.observe(assistantToolUse('t1', 'Write', '/repo/fresh.ts'))
        await reporter.onTurnEnd()

        expect(await store.listChain(SID)).toHaveLength(1) // 基线快照已打
        const [payload] = sentPayloads(send)
        expect(payload!.git).toBeNull()
        expect(payload!.files).toEqual([{ path: '/repo/fresh.ts', kind: 'modify', additions: 0, deletions: 0 }])
    })
})

describe('ensureBaselineSnapshot（会话启动基线）', () => {
    it('链空：打一颗基线快照——首卡基线从 HEAD 树收窄为会话起点，历史未提交变更不入首卡', async () => {
        const store = createInMemoryTurnSnapshotStore()
        let captures = 0
        const orig = store.capture.bind(store)
        store.capture = async (id: string) => { captures += 1; return orig(id) }

        await ensureBaselineSnapshot(store, SID)
        expect(captures).toBe(1)
        expect(await store.listChain(SID)).toHaveLength(1)

        // 已有链（重启 resume）：不补打
        await ensureBaselineSnapshot(store, SID)
        expect(captures).toBe(1)
    })

    it('baseline 失败吞错不抛（不阻塞会话启动）', async () => {
        const broken = {
            capture: async () => { throw new Error('baseline exploded') },
            listChain: async () => [],
            lastTurnDiff: async () => null,
            diffTrees: async () => [],
            clearSession: async () => 0,
        }
        await expect(ensureBaselineSnapshot(broken as never, SID)).resolves.toBeUndefined()
    })
})

describe('TurnDiffReporter（非 git 投影降级口径）', () => {    it('store 为 null：structuredPatch 行数累加，同文件合并，git: null', async () => {
        const send = vi.fn()
        const reporter = new TurnDiffReporter(SID, null, send)
        reporter.observe(assistantToolUse('t1', 'Edit', '/proj/a.ts'))
        reporter.observe(userToolResult('t1', [' ctx', '+added', '-removed']))
        reporter.observe(assistantToolUse('t2', 'Edit', '/proj/a.ts')) // 同文件第二笔
        reporter.observe(userToolResult('t2', ['+more']))
        reporter.observe(assistantToolUse('t3', 'Bash', '/proj/na')) // 非编辑族：不观测
        await reporter.onTurnEnd()

        const [payload] = sentPayloads(send)
        expect(payload!.git).toBeNull()
        expect(payload!.turnIndex).toBe(1)
        expect(payload!.baseTurnIndex).toBeNull()
        expect(payload!.files).toEqual([{ path: '/proj/a.ts', kind: 'modify', additions: 2, deletions: 1 }])
        expect(payload!.stats).toEqual({ files: 1, additions: 2, deletions: 1 })
    })

    it('并行工具调用合并消息：多条 tool_result 与 toolUseResult 数组按序归位，不漏计', async () => {
        const send = vi.fn()
        const reporter = new TurnDiffReporter(SID, null, send)
        reporter.observe(assistantToolUse('t1', 'Edit', '/proj/a.ts'))
        reporter.observe(assistantToolUse('t2', 'Edit', '/proj/b.ts'))
        reporter.observe({
            type: 'user',
            message: {
                role: 'user',
                content: [
                    { type: 'tool_result', tool_use_id: 't1' },
                    { type: 'tool_result', tool_use_id: 't2' },
                ],
            },
            // 合并消息形态：toolUseResult 为数组，与 tool_result 顺序一一对应
            toolUseResult: [
                { structuredPatch: [{ lines: ['+a1', '-a2'] }] },
                { structuredPatch: [{ lines: ['+b1', '+b2'] }] },
            ],
        } as unknown as RawJSONLines)
        await reporter.onTurnEnd()

        const [payload] = sentPayloads(send)
        expect(payload!.files).toEqual([
            { path: '/proj/a.ts', kind: 'modify', additions: 1, deletions: 1 },
            { path: '/proj/b.ts', kind: 'modify', additions: 2, deletions: 0 },
        ])
    })

    it('本轮无编辑观测：不出卡；下一轮计数接续', async () => {
        const send = vi.fn()
        const reporter = new TurnDiffReporter(SID, null, send)
        await reporter.onTurnEnd()
        expect(send).not.toHaveBeenCalled()

        reporter.observe(assistantToolUse('t1', 'MultiEdit', '/b.ts'))
        await reporter.onTurnEnd()
        const [payload] = sentPayloads(send)
        expect(payload!.turnIndex).toBe(2) // 计数只在合成时递增
    })

    it('snake_case tool_use_result（真实 SDK 消息形态，E2E 实证）：投影与 journal 照常采集', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'mobi-reporter-snake-'))
        try {
            // 文件真实在盘上（Edit 后的磁盘内容即 afterContent，落笔读盘补全的前提）
            const filePath = join(dir, 'a.ts')
            await writeFile(filePath, 'new\n', 'utf8')
            const journal = await PersistentToolChangeJournal.open(join(dir, 'tool-changes.json'))
            const send = vi.fn()
            const reporter = new TurnDiffReporter(SID, null, send, journal)
            reporter.observe(assistantToolUse('t1', 'Edit', filePath))
            reporter.observe({
                type: 'user',
                message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1' }] },
                // 真实 CC 消息是 snake_case 键（web CLAUDE.md「跨格式字段访问」的前提事实）
                tool_use_result: {
                    filePath,
                    originalFile: 'old\n',
                    structuredPatch: [{ lines: ['-old', '+new'] }],
                },
            } as unknown as RawJSONLines)
            await reporter.onTurnEnd()

            const [payload] = sentPayloads(send)
            expect(payload!.stats).toEqual({ files: 1, additions: 1, deletions: 1 })
            const entry = journal.journal.get(filePath)!
            expect(entry.beforeContent).toBe('old\n')
            await journal.dispose()
        } finally {
            await rm(dir, { recursive: true, force: true })
        }
    })
})

describe('TurnDiffReporter（journal 全文对采集，审查 v2 票03）', () => {
    it('Edit 带 originalFile 记 before 占位、Write 带 content 记 after，同 path 归并', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'mobi-reporter-journal-'))
        try {
            const journal = await PersistentToolChangeJournal.open(join(dir, 'tool-changes.json'))
            const send = vi.fn()
            const reporter = new TurnDiffReporter(SID, null, send, journal)

            // Edit：originalFile（编辑前全文）+ structuredPatch
            reporter.observe(assistantToolUse('t1', 'Edit', '/proj/a.ts'))
            reporter.observe({
                type: 'user',
                message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1' }] },
                toolUseResult: {
                    filePath: '/proj/a.ts',
                    originalFile: 'line1\nline2\n',
                    structuredPatch: [{ lines: ['-line2', '+line2 edited'] }],
                },
            } as unknown as RawJSONLines)
            // Write：content（写入后全文）
            reporter.observe(assistantToolUse('t2', 'Write', '/proj/a.ts'))
            reporter.observe({
                type: 'user',
                message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't2' }] },
                toolUseResult: { filePath: '/proj/a.ts', content: 'new full content\n' },
            } as unknown as RawJSONLines)
            // 非编辑族结果（两者都缺）：不入 journal
            reporter.observe(assistantToolUse('t3', 'Bash', '/proj/x.ts'))
            reporter.observe({
                type: 'user',
                message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't3' }] },
                toolUseResult: { stdout: 'ls output' },
            } as unknown as RawJSONLines)

            await reporter.onTurnEnd()
            const entry = journal.journal.get('/proj/a.ts')!
            expect(entry.beforeContent).toBe('line1\nline2\n')
            expect(entry.afterContent).toBe('new full content\n')
            expect(entry.writeCount).toBe(2)
            expect(entry.toolNames).toEqual(['Edit', 'Write'])
            expect(journal.journal.listPaths()).toEqual(['/proj/a.ts'])
            await journal.dispose()
        } finally {
            await rm(dir, { recursive: true, force: true })
        }
    })

    it('无 journal（缺省构造）：采集路径静默跳过，投影口径不受影响', async () => {
        const send = vi.fn()
        const reporter = new TurnDiffReporter(SID, null, send)
        reporter.observe(assistantToolUse('t1', 'Edit', '/proj/a.ts'))
        reporter.observe(userToolResult('t1', ['+x']))
        await reporter.onTurnEnd()
        expect(sentPayloads(send)).toHaveLength(1)
    })
})

describe('TurnDiffReporter（journal 主源 + 封口归档，审查 v3 票01/02）', () => {
    /** 构造带 originalFile 的 Edit 结果消息（真实 snake_case 形态） */
    function editResult(toolUseId: string, filePath: string, originalFile: string): RawJSONLines {
        return {
            type: 'user',
            message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId }] },
            tool_use_result: {
                filePath,
                originalFile,
                structuredPatch: [{ lines: ['-old', '+new'] }],
            },
        } as unknown as RawJSONLines
    }

    it('journal 累积命中：payload 来自累积而非快照 diff（git:null），快照照打不断链', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'mobi-reporter-jprimary-'))
        try {
            const filePath = join(dir, 'a.ts')
            await writeFile(filePath, 'new\n', 'utf8')
            const store = createInMemoryTurnSnapshotStore({
                chains: { [SID]: [{ index: 1, tree: 't1' }] },
                // 快照口径「看得见」的额外文件（模拟并发会话/手改）——journal 主源必须无视它
                trees: { t1: { 'a.ts': ['old'] }, 'fake-tree-2': { 'a.ts': ['new'], 'other-session.ts': ['x'] } },
            })
            const archive = createInMemoryTurnArchiveStore()
            const send = vi.fn()
            const reporter = new TurnDiffReporter(SID, store, send, undefined, archive)

            reporter.observe(assistantToolUse('t1', 'Edit', filePath))
            reporter.observe(editResult('t1', filePath, 'old\n'))
            await reporter.onTurnEnd()

            const [payload] = sentPayloads(send)
            // 归因：只含本会话编辑的文件，快照 diff 里的 other-session.ts 不出现
            expect(payload!.files.map((f) => f.path)).toEqual([filePath])
            expect(payload!.git).toBeNull()
            expect(payload!.stats).toEqual({ files: 1, additions: 1, deletions: 1 })
            // 快照照打（会话资产不断链）
            expect(await store.listChain(SID)).toHaveLength(2)
            // 封口归档：turnIndex 1、files 带行数与合成 patch（B 方案：无全文字段）
            const [sealed] = archive.records()
            expect(sealed!.turnIndex).toBe(1)
            expect(sealed!.baseTurnIndex).toBeNull()
            expect(sealed!.files[0]).toMatchObject({ path: filePath, writeCount: 1, additions: 1, deletions: 1, oversizedPatch: false })
            expect(sealed!.files[0]!.patch).toContain('+new')
        } finally {
            await rm(dir, { recursive: true, force: true })
        }
    })

    it('连续 turn 封口：滚动单条只保最新轮，turnIndex/baseTurnIndex 链路经 payload 断言', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'mobi-reporter-jseq-'))
        try {
            const fileA = join(dir, 'a.ts')
            const fileB = join(dir, 'b.ts')
            const archive = createInMemoryTurnArchiveStore()
            const send = vi.fn()
            const reporter = new TurnDiffReporter(SID, null, send, undefined, archive)

            await writeFile(fileA, 'a2\n', 'utf8')
            reporter.observe(assistantToolUse('t1', 'Edit', fileA))
            reporter.observe(editResult('t1', fileA, 'a1\n'))
            await reporter.onTurnEnd()

            await writeFile(fileB, 'b1\n', 'utf8')
            reporter.observe(assistantToolUse('t2', 'Write', fileB))
            reporter.observe({
                type: 'user',
                message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't2' }] },
                tool_use_result: { filePath: fileB, content: 'b1\n' },
            } as unknown as RawJSONLines)
            await reporter.onTurnEnd()

            // 滚动单条：归档只见最新轮（turn 2）
            const turns = await archive.listTurns()
            expect(turns.map((t) => t.turnIndex)).toEqual([2])
            expect(turns[0]!.baseTurnIndex).toBe(1)
            // 第二轮卡只含 b（a 未在本轮编辑）
            const payloads = sentPayloads(send)
            expect(payloads[1]!.files.map((f) => f.path)).toEqual([fileB])
            expect(payloads[1]!.files[0]!.kind).toBe('add')
        } finally {
            await rm(dir, { recursive: true, force: true })
        }
    })

    it('Edit 落笔读盘补 afterContent：journal 记全全文对，writeCount 不因补读翻倍，kind 正确 modify', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'mobi-reporter-afterread-'))
        try {
            const filePath = join(dir, 'a.ts')
            await writeFile(filePath, 'old+new\n', 'utf8')
            const journal = await PersistentToolChangeJournal.open(join(dir, 'tool-changes.json'))
            const send = vi.fn()
            const reporter = new TurnDiffReporter(SID, null, send, journal)

            reporter.observe(assistantToolUse('t1', 'Edit', filePath))
            reporter.observe(editResult('t1', filePath, 'old\n'))
            await reporter.onTurnEnd()

            const entry = journal.journal.get(filePath)!
            expect(entry.beforeContent).toBe('old\n')
            expect(entry.afterContent).toBe('old+new\n')
            expect(entry.writeCount).toBe(1) // 补读不计写入次数
            const [payload] = sentPayloads(send)
            expect(payload!.files[0]!.kind).toBe('modify') // 非 delete（after 占位 null 的假象）
            await journal.dispose()
        } finally {
            await rm(dir, { recursive: true, force: true })
        }
    })

    it('同 turn 同文件两次 Edit 补读乱序 resolve：末次内容不被中间态覆盖（按调度序应用）', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'mobi-reporter-race-'))
        try {
            const filePath = join(dir, 'a.ts')
            const journal = await PersistentToolChangeJournal.open(join(dir, 'tool-changes.json'))
            const send = vi.fn()
            const reporter = new TurnDiffReporter(SID, null, send, journal)

            // 两次 Edit 的补读并发在途：R1（先调度）慢返回中间态、R2（后调度）快返回末次
            readScript.reads.push(
                { path: filePath, value: 'mid\n', delayMs: 30 },
                { path: filePath, value: 'final\n', delayMs: 0 },
            )
            reporter.observe(assistantToolUse('t1', 'Edit', filePath))
            reporter.observe(editResult('t1', filePath, 'v0\n'))
            reporter.observe(assistantToolUse('t2', 'Edit', filePath))
            reporter.observe(editResult('t2', filePath, 'mid\n'))
            await reporter.onTurnEnd()

            // 归并规则 before 取首次 / after 取末次：乱序回写会把 after 钉死在中间态
            const entry = journal.journal.get(filePath)!
            expect(entry.beforeContent).toBe('v0\n')
            expect(entry.afterContent).toBe('final\n')
            await journal.dispose()
        } finally {
            await rm(dir, { recursive: true, force: true })
        }
    })

    it('归档 seal 失败：吞错不出错，卡片照常发送', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'mobi-reporter-sealfail-'))
        try {
            const brokenArchive = {
                seal: async () => { throw new Error('disk full') },
                listTurns: async () => [],
                loadTurn: async () => null,
                loadLatest: async () => null,
            }
            const send = vi.fn()
            const reporter = new TurnDiffReporter(SID, null, send, undefined, brokenArchive)
            reporter.observe(assistantToolUse('t1', 'Write', join(dir, 'x.ts')))
            reporter.observe({
                type: 'user',
                message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1' }] },
                tool_use_result: { filePath: join(dir, 'x.ts'), content: 'x\n' },
            } as unknown as RawJSONLines)
            await expect(reporter.onTurnEnd()).resolves.toBeUndefined()
            expect(sentPayloads(send)).toHaveLength(1)
        } finally {
            await rm(dir, { recursive: true, force: true })
        }
    })
})

describe('TurnDiffReporter（turn-archive B：滚动单条 + 封口存 patch）', () => {
    /** 构造带 originalFile 的 Edit 结果消息（真实 snake_case 形态） */
    function editResult(toolUseId: string, filePath: string, originalFile: string): RawJSONLines {
        return {
            type: 'user',
            message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId }] },
            tool_use_result: {
                filePath,
                originalFile,
                structuredPatch: [{ lines: ['-old', '+new'] }],
            },
        } as unknown as RawJSONLines
    }

    it('封口归档只存统计+patch：无 beforeContent/afterContent，patch 为合成的 unified diff', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'mobi-reporter-patch-'))
        try {
            const filePath = join(dir, 'a.ts')
            await writeFile(filePath, 'new\n', 'utf8')
            const archivePath = join(dir, 'turn-archive.json')
            const archive = new FileTurnArchiveStore(archivePath)
            const send = vi.fn()
            const reporter = new TurnDiffReporter(SID, null, send, undefined, archive)

            reporter.observe(assistantToolUse('t1', 'Edit', filePath))
            reporter.observe(editResult('t1', filePath, 'old\n'))
            await reporter.onTurnEnd()

            const sealed = (await archive.loadLatest())!
            expect(sealed.turnIndex).toBe(1)
            const f = sealed.files[0]!
            expect(f).not.toHaveProperty('beforeContent')
            expect(f).not.toHaveProperty('afterContent')
            expect(f.patch).toContain('-old')
            expect(f.patch).toContain('+new')
            expect(f.oversizedPatch).toBe(false)
            expect(f.additions).toBe(1)
            expect(f.deletions).toBe(1)
            expect(f.writeCount).toBe(1)
        } finally {
            await rm(dir, { recursive: true, force: true })
        }
    })

    it('patch 超 5000 行：patch 降级为空 + oversizedPatch 打标，counts 保留', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'mobi-reporter-oversize-'))
        try {
            const filePath = join(dir, 'big.ts')
            const big = Array.from({ length: 6000 }, (_, i) => `line ${i}`).join('\n') + '\n'
            await writeFile(filePath, big, 'utf8')
            const archive = new FileTurnArchiveStore(join(dir, 'turn-archive.json'))
            const send = vi.fn()
            const reporter = new TurnDiffReporter(SID, null, send, undefined, archive)

            reporter.observe(assistantToolUse('t1', 'Write', filePath))
            reporter.observe({
                type: 'user',
                message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1' }] },
                tool_use_result: { filePath, content: big },
            } as unknown as RawJSONLines)
            await reporter.onTurnEnd()

            const f = (await archive.loadLatest())!.files[0]!
            expect(f.patch).toBe('')
            expect(f.oversizedPatch).toBe(true)
            expect(f.additions).toBe(6000)
            expect(f.deletions).toBe(0)
        } finally {
            await rm(dir, { recursive: true, force: true })
        }
    })

    it('重启（新 reporter 实例）：turnIndex 从归档最新轮接续，不再内存自增断档', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'mobi-reporter-resume-'))
        try {
            const filePath = join(dir, 'a.ts')
            const archivePath = join(dir, 'turn-archive.json')
            const send1 = vi.fn()
            const first = new TurnDiffReporter(SID, null, send1, undefined, new FileTurnArchiveStore(archivePath))
            await writeFile(filePath, 'v2\n', 'utf8')
            first.observe(assistantToolUse('t1', 'Edit', filePath))
            first.observe(editResult('t1', filePath, 'v1\n'))
            await first.onTurnEnd()

            // 新实例（重启语义）：同一归档文件
            const send2 = vi.fn()
            const second = new TurnDiffReporter(SID, null, send2, undefined, new FileTurnArchiveStore(archivePath))
            await writeFile(filePath, 'v3\n', 'utf8')
            second.observe(assistantToolUse('t2', 'Edit', filePath))
            second.observe(editResult('t2', filePath, 'v2\n'))
            await second.onTurnEnd()

            const payload = sentPayloads(send2)[0]!
            expect(payload.turnIndex).toBe(2)
            expect(payload.baseTurnIndex).toBe(1)
            const sealed = (await new FileTurnArchiveStore(archivePath).loadLatest())!
            expect(sealed.turnIndex).toBe(2)
            expect(sealed.files[0]!.patch).toContain('+v3')
        } finally {
            await rm(dir, { recursive: true, force: true })
        }
    })
})
