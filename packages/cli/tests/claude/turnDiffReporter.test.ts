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
 * TurnDiffReporter 合成契约：观测序列 → 载荷断言。归因口径走 turn 内累积 +
 * 封口归档（turn-archive B：滚动单条 + 封口存 patch），降级投影口径直接喂
 * RawJSONLines 消息序列。全文对采集语义经封口归档的 patch/counts 断言。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { RawJSONLines } from '@/claude/types'
import { TURN_DIFF_EVENT, TurnDiffPayloadSchema, type TurnDiffPayload } from '@mobi/shared'
import { TurnDiffReporter } from '@/claude/turnDiffReporter'
import { createInMemoryTurnArchiveStore, FileTurnArchiveStore, type TurnArchiveRecord } from '@/modules/common/git/turnArchiveStore'
import { FileTurnFulltextStore } from '@/modules/common/git/turnFulltextStore'
import { git } from '@/modules/common/git/gitExec'

// 补读竞态脚本：同 path 多次补读并发时，模拟「R1 慢返回中间态、R2 快返回末次」的
// resolve 乱序（磁盘真实时序 = 调度序）。未命中的 readFile 调用透传 actual。
const readScript = vi.hoisted(() => ({ reads: [] as Array<{ path: string; value: string; delayMs: number; done?: boolean; error?: boolean }> }))
vi.mock('node:fs/promises', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:fs/promises')>()
    return {
        ...actual,
        readFile: async (path: string, options?: unknown) => {
            const scripted = readScript.reads.find((r) => r.path === path && !r.done)
            if (!scripted) return actual.readFile(path, options as never)
            scripted.done = true
            await new Promise((resolve) => setTimeout(resolve, scripted.delayMs))
            // error 脚本 = 模拟 ENOENT（fs 线程池并发下「读不存在的文件」与测试的建盘
            // 写无顺序保证，必须脚本化才能确定 pre-read 拿到 ENOENT）
            if (scripted.error) throw Object.assign(new Error('ENOENT (scripted)'), { code: 'ENOENT' })
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

describe('TurnDiffReporter（投影降级口径）', () => {
    it('无累积时降级：structuredPatch 行数累加，同文件合并，git: null', async () => {
        const send = vi.fn()
        const reporter = new TurnDiffReporter(send)
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
        const reporter = new TurnDiffReporter(send)
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
        const reporter = new TurnDiffReporter(send)
        await reporter.onTurnEnd()
        expect(send).not.toHaveBeenCalled()

        reporter.observe(assistantToolUse('t1', 'MultiEdit', '/b.ts'))
        await reporter.onTurnEnd()
        const [payload] = sentPayloads(send)
        expect(payload!.turnIndex).toBe(2) // 计数只在合成时递增
    })

    it('snake_case tool_use_result（真实 SDK 消息形态，E2E 实证）：归因照常采集', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'mobi-reporter-snake-'))
        try {
            // 文件真实在盘上（Edit 后的磁盘内容即 afterContent，落笔读盘补全的前提）
            const filePath = join(dir, 'a.ts')
            await writeFile(filePath, 'new\n', 'utf8')
            const archive = createInMemoryTurnArchiveStore()
            const send = vi.fn()
            const reporter = new TurnDiffReporter(send, archive)
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
            const sealed = archive.records()[0]!
            expect(sealed.files[0]).toMatchObject({ path: filePath, writeCount: 1, additions: 1, deletions: 1 })
        } finally {
            await rm(dir, { recursive: true, force: true })
        }
    })
})

describe('TurnDiffReporter（归因主源 + 封口归档）', () => {
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

    it('journal 累积命中：payload 只含本会话编辑的文件（归因免疫并发/手改），封口归档落 patch', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'mobi-reporter-jprimary-'))
        try {
            const filePath = join(dir, 'a.ts')
            await writeFile(filePath, 'new\n', 'utf8')
            // 工作区里预置「别人改的」文件（模拟并发会话/手改）——归因主源必须无视它
            await writeFile(join(dir, 'other-session.ts'), 'x\n', 'utf8')
            const archive = createInMemoryTurnArchiveStore()
            const send = vi.fn()
            const reporter = new TurnDiffReporter(send, archive)

            reporter.observe(assistantToolUse('t1', 'Edit', filePath))
            reporter.observe(editResult('t1', filePath, 'old\n'))
            await reporter.onTurnEnd()

            const [payload] = sentPayloads(send)
            expect(payload!.files.map((f) => f.path)).toEqual([filePath])
            expect(payload!.git).toBeNull()
            expect(payload!.stats).toEqual({ files: 1, additions: 1, deletions: 1 })
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

    it('全文对采集：Edit 记 before、Write 记 after，同 path 归并；非编辑族不入累积', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'mobi-reporter-collect-'))
        try {
            const filePath = join(dir, 'a.ts')
            await writeFile(filePath, 'new full content\n', 'utf8')
            const archive = createInMemoryTurnArchiveStore()
            const send = vi.fn()
            const reporter = new TurnDiffReporter(send, archive)

            // Edit：originalFile（编辑前全文）+ structuredPatch
            reporter.observe(assistantToolUse('t1', 'Edit', filePath))
            reporter.observe(editResult('t1', filePath, 'line1\nline2\n'))
            // Write：content（写入后全文）
            reporter.observe(assistantToolUse('t2', 'Write', filePath))
            reporter.observe({
                type: 'user',
                message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't2' }] },
                tool_use_result: { filePath, content: 'new full content\n' },
            } as unknown as RawJSONLines)
            await reporter.onTurnEnd()

            const sealed = archive.records()[0]!
            const f = sealed.files[0]!
            expect(f).toMatchObject({ path: filePath, writeCount: 2 })
            expect(f.toolNames).toEqual(['Edit', 'Write'])
            // patch 由内容对合成：before 取首次、after 取末次（Write 的 content）
            expect(f.patch).toContain('-line2')
            expect(f.patch).toContain('+new full content')
        } finally {
            await rm(dir, { recursive: true, force: true })
        }
    })

    it('非编辑族结果（Bash 等）：不入累积，整轮无编辑不出卡不封口', async () => {
        const archive = createInMemoryTurnArchiveStore()
        const send = vi.fn()
        const reporter = new TurnDiffReporter(send, archive)
        reporter.observe(assistantToolUse('t3', 'Bash', '/proj/x.ts'))
        reporter.observe({
            type: 'user',
            message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't3' }] },
            toolUseResult: { stdout: 'ls output' },
        } as unknown as RawJSONLines)
        await reporter.onTurnEnd()

        expect(sentPayloads(send)).toHaveLength(0)
        expect(archive.records()).toHaveLength(0)
    })

    it('连续 turn 封口：滚动单条只保最新轮，turnIndex/baseTurnIndex 链路经 payload 断言', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'mobi-reporter-jseq-'))
        try {
            const fileA = join(dir, 'a.ts')
            const fileB = join(dir, 'b.ts')
            const archive = createInMemoryTurnArchiveStore()
            const send = vi.fn()
            const reporter = new TurnDiffReporter(send, archive)

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

    it('Edit 落笔读盘补 afterContent：归档 patch 为磁盘末态，writeCount 不因补读翻倍', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'mobi-reporter-afterread-'))
        try {
            const filePath = join(dir, 'a.ts')
            await writeFile(filePath, 'old+new\n', 'utf8')
            const archive = createInMemoryTurnArchiveStore()
            const send = vi.fn()
            const reporter = new TurnDiffReporter(send, archive)

            reporter.observe(assistantToolUse('t1', 'Edit', filePath))
            reporter.observe(editResult('t1', filePath, 'old\n'))
            await reporter.onTurnEnd()

            const sealed = archive.records()[0]!
            const f = sealed.files[0]!
            expect(f.writeCount).toBe(1) // 补读不计写入次数
            expect(f.kind).toBe('modify') // 非 delete（after 占位 null 的假象）
            // 补读后的磁盘内容作为 after 参与合成
            expect(f.patch).toContain('+old+new')
        } finally {
            await rm(dir, { recursive: true, force: true })
        }
    })

    it('同 turn 同文件两次 Edit 补读乱序 resolve：末次内容不被中间态覆盖（按调度序应用）', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'mobi-reporter-race-'))
        try {
            const filePath = join(dir, 'a.ts')
            const archive = createInMemoryTurnArchiveStore()
            const send = vi.fn()
            const reporter = new TurnDiffReporter(send, archive)

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
            const sealed = archive.records()[0]!
            expect(sealed.files[0]!.patch).toContain('+final')
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
            const reporter = new TurnDiffReporter(send, brokenArchive)
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

describe('TurnDiffReporter（sidechain/subagent 写工具补采）', () => {
    /** sidechain assistant tool_use（sdkToLogConverter 实际形态：顶层 isSidechain/parentToolUseId 标记） */
    function sidechainAssistantToolUse(toolUseId: string, name: string, filePath: string, parentToolUseId: string): RawJSONLines {
        return {
            type: 'assistant',
            isSidechain: true,
            parentToolUseId,
            message: {
                role: 'assistant',
                content: [{ type: 'tool_use', id: toolUseId, name, input: { file_path: filePath } }],
            },
        } as unknown as RawJSONLines
    }

    /** sidechain user tool_result（snake_case tool_use_result，带 originalFile 全文对） */
    function sidechainEditResult(toolUseId: string, filePath: string, originalFile: string, parentToolUseId: string): RawJSONLines {
        return {
            type: 'user',
            isSidechain: true,
            parentToolUseId,
            message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId }] },
            tool_use_result: {
                filePath,
                originalFile,
                structuredPatch: [{ lines: ['-old', '+new'] }],
            },
        } as unknown as RawJSONLines
    }

    it('sidechain Edit 全文对进入封口归档：subagent 编辑归到外层 turn', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'mobi-reporter-sidechain-'))
        try {
            const filePath = join(dir, 'sub.ts')
            await writeFile(filePath, 'new\n', 'utf8')
            const archive = createInMemoryTurnArchiveStore()
            const send = vi.fn()
            const reporter = new TurnDiffReporter(send, archive)

            reporter.observe(sidechainAssistantToolUse('st1', 'Edit', filePath, 'task-1'))
            reporter.observe(sidechainEditResult('st1', filePath, 'old\n', 'task-1'))
            await reporter.onTurnEnd()

            const [payload] = sentPayloads(send)
            expect(payload!.files.map((f) => f.path)).toEqual([filePath])
            const sealed = archive.records()[0]!
            expect(sealed.files[0]).toMatchObject({ path: filePath, writeCount: 1, additions: 1, deletions: 1 })
            expect(sealed.files[0]!.patch).toContain('+new')
        } finally {
            await rm(dir, { recursive: true, force: true })
        }
    })

    it('主线 + sidechain 同 turn 混合编辑同文件：before 取首次 / after 取末次 / writeCount 累加', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'mobi-reporter-mixed-'))
        try {
            const filePath = join(dir, 'a.ts')
            await writeFile(filePath, 'final\n', 'utf8')
            const archive = createInMemoryTurnArchiveStore()
            const send = vi.fn()
            const reporter = new TurnDiffReporter(send, archive)

            // 主线 Edit（before v0）→ sidechain Edit（before v1）→ 主线 Write（after final）
            reporter.observe(assistantToolUse('t1', 'Edit', filePath))
            reporter.observe({
                type: 'user',
                message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1' }] },
                tool_use_result: { filePath, originalFile: 'v0\n', structuredPatch: [{ lines: ['-v0', '+v1'] }] },
            } as unknown as RawJSONLines)
            reporter.observe(sidechainAssistantToolUse('st1', 'Edit', filePath, 'task-1'))
            reporter.observe(sidechainEditResult('st1', filePath, 'v1\n', 'task-1'))
            reporter.observe(assistantToolUse('t2', 'Write', filePath))
            reporter.observe({
                type: 'user',
                message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't2' }] },
                tool_use_result: { filePath, content: 'final\n' },
            } as unknown as RawJSONLines)
            await reporter.onTurnEnd()

            const sealed = archive.records()[0]!
            const f = sealed.files[0]!
            expect(f).toMatchObject({ path: filePath, writeCount: 3 })
            expect(f.toolNames).toEqual(['Edit', 'Write']) // 保序去重
            expect(f.patch).toContain('-v0')
            expect(f.patch).toContain('+final')
        } finally {
            await rm(dir, { recursive: true, force: true })
        }
    })

    it('Task 工具自身的结果不产生文件条目（非编辑族天然排除）', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'mobi-reporter-tasktool-'))
        try {
            const archive = createInMemoryTurnArchiveStore()
            const send = vi.fn()
            const reporter = new TurnDiffReporter(send, archive)

            reporter.observe(assistantToolUse('t1', 'Task', '/proj/na'))
            reporter.observe({
                type: 'user',
                message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1' }] },
                tool_use_result: { stdout: 'subagent finished, edited 3 files' },
            } as unknown as RawJSONLines)
            await reporter.onTurnEnd()

            expect(sentPayloads(send)).toHaveLength(0)
            expect(archive.records()).toHaveLength(0)
        } finally {
            await rm(dir, { recursive: true, force: true })
        }
    })

    // ── sidechain 兜底（E2E 实证：CC 不给 sidechain tool_result 附 toolUseResult）──
    /** sidechain user tool_result（E2E 实证形态：无 toolUseResult，只有归位键） */
    function bareResult(toolUseId: string, isError = false): RawJSONLines {
        return {
            type: 'user',
            isSidechain: true,
            message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, ...(isError ? { is_error: true } : {}) }] },
        } as unknown as RawJSONLines
    }

    it('sidechain Write 无 toolUseResult：tool_use 预读 before=null（新建）+ result 读盘 after，add 全文对入归档', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'mobi-reporter-scfallback-'))
        try {
            const filePath = join(dir, 'sub-demo.txt')
            const archive = createInMemoryTurnArchiveStore()
            const send = vi.fn()
            const reporter = new TurnDiffReporter(send, archive)

            // 预读脚本化：Write 新建前文件不存在（线程池并发下脚本化才能锁定 ENOENT → before null）
            readScript.reads.push({ path: filePath, value: '', delayMs: 0, error: true })
            reporter.observe(sidechainAssistantToolUse('st1', 'Write', filePath, 'task-1'))
            await writeFile(filePath, 'sub\n', 'utf8') // 工具落笔发生在 tool_use 之后
            reporter.observe(bareResult('st1'))
            await reporter.onTurnEnd()

            const [payload] = sentPayloads(send)
            expect(payload!.files).toHaveLength(1)
            expect(payload!.files[0]).toMatchObject({ path: filePath, kind: 'add', additions: 1, deletions: 0 })
            const sealed = archive.records()[0]!
            expect(sealed.files[0]).toMatchObject({ path: filePath, writeCount: 1, oversizedPatch: false })
            expect(sealed.files[0]!.patch).toContain('+sub')
        } finally {
            await rm(dir, { recursive: true, force: true })
        }
    })

    it('sidechain Edit 无 toolUseResult：预读 before + 读盘 after → modify 全文对', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'mobi-reporter-scfallback-edit-'))
        try {
            const filePath = join(dir, 'sub-edit.txt')
            await writeFile(filePath, 'old\n', 'utf8')
            const archive = createInMemoryTurnArchiveStore()
            const send = vi.fn()
            const reporter = new TurnDiffReporter(send, archive)

            // 预读脚本化：fs 线程池并发下真实读与测试的覆写无顺序保证（实踩：读到截断
            // 空文件），脚本锁定 before='old\n'；after 读（第二笔）透传真实盘 → 'new\n'
            readScript.reads.push({ path: filePath, value: 'old\n', delayMs: 0 })
            reporter.observe(sidechainAssistantToolUse('st1', 'Edit', filePath, 'task-1'))
            await writeFile(filePath, 'new\n', 'utf8')
            reporter.observe(bareResult('st1'))
            await reporter.onTurnEnd()

            const [payload] = sentPayloads(send)
            expect(payload!.files[0]).toMatchObject({ path: filePath, kind: 'modify', additions: 1, deletions: 1 })
            const sealed = archive.records()[0]!
            expect(sealed.files[0]!.patch).toContain('-old')
            expect(sealed.files[0]!.patch).toContain('+new')
        } finally {
            await rm(dir, { recursive: true, force: true })
        }
    })

    it('sidechain result is_error：失败的编辑不入账（sidechain tool_use 也不进投影，无 0/0 噪声）', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'mobi-reporter-scerror-'))
        try {
            const filePath = join(dir, 'sub-err.txt')
            await writeFile(filePath, 'old\n', 'utf8')
            const archive = createInMemoryTurnArchiveStore()
            const send = vi.fn()
            const reporter = new TurnDiffReporter(send, archive)

            reporter.observe(sidechainAssistantToolUse('st1', 'Edit', filePath, 'task-1'))
            await writeFile(filePath, 'new\n', 'utf8')
            reporter.observe(bareResult('st1', true))
            await reporter.onTurnEnd()

            expect(sentPayloads(send)).toHaveLength(0)
            expect(archive.records()).toHaveLength(0)
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
            const reporter = new TurnDiffReporter(send, archive)

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
            const reporter = new TurnDiffReporter(send, archive)

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
            const first = new TurnDiffReporter(send1, new FileTurnArchiveStore(archivePath))
            await writeFile(filePath, 'v2\n', 'utf8')
            first.observe(assistantToolUse('t1', 'Edit', filePath))
            first.observe(editResult('t1', filePath, 'v1\n'))
            await first.onTurnEnd()

            // 新实例（重启语义）：同一归档文件
            const send2 = vi.fn()
            const second = new TurnDiffReporter(send2, new FileTurnArchiveStore(archivePath))
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

describe('TurnDiffReporter（hydration：全文目录 + 归档 ref）', () => {
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

    it('封口落 a/b 全文目录，归档条目带 ref，patch 来自目录模式合成', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'mobi-reporter-fulltext-'))
        try {
            const filePath = join(dir, 'src', 'a.ts')
            await mkdir(join(dir, 'src'), { recursive: true })
            await writeFile(filePath, 'new\n', 'utf8')
            const archive = new FileTurnArchiveStore(join(dir, '.mobi', 'turn-diffs', 's-1', 'turn-archive.json'))
            const fulltext = new FileTurnFulltextStore(join(dir, '.mobi', 'turn-diffs', 's-1'), dir, git)
            const send = vi.fn()
            const reporter = new TurnDiffReporter(send, archive, fulltext)

            reporter.observe(assistantToolUse('t1', 'Edit', filePath))
            reporter.observe(editResult('t1', filePath, 'old\n'))
            await reporter.onTurnEnd()

            const sealed = (await archive.loadLatest())!
            const f = sealed.files[0]!
            expect(f.ref).toEqual({ before: join('a', 'src', 'a.ts'), after: join('b', 'src', 'a.ts') })
            expect(f.patch).toContain('-old')
            expect(f.patch).toContain('+new')
            // 全文在盘
            const turnDir = join(dir, '.mobi', 'turn-diffs', 's-1', '1')
            expect(await readFile(join(turnDir, 'a', 'src', 'a.ts'), 'utf8')).toBe('old\n')
            expect(await readFile(join(turnDir, 'b', 'src', 'a.ts'), 'utf8')).toBe('new\n')
        } finally {
            await rm(dir, { recursive: true, force: true })
        }
    })

    it('工作区外路径：无 ref 无 patch 来源走单文件兜底合成，归档照常封口', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'mobi-reporter-escape-'))
        const outside = await mkdtemp(join(tmpdir(), 'mobi-reporter-outside-'))
        try {
            const filePath = join(outside, 'x.ts')
            await writeFile(filePath, 'new\n', 'utf8')
            const archive = new FileTurnArchiveStore(join(dir, '.mobi', 'turn-diffs', 's-1', 'turn-archive.json'))
            const fulltext = new FileTurnFulltextStore(join(dir, '.mobi', 'turn-diffs', 's-1'), dir, git)
            const send = vi.fn()
            const reporter = new TurnDiffReporter(send, archive, fulltext)

            reporter.observe(assistantToolUse('t1', 'Edit', filePath))
            reporter.observe(editResult('t1', filePath, 'old\n'))
            await reporter.onTurnEnd()

            const sealed = (await archive.loadLatest())!
            const f = sealed.files[0]!
            expect(f.ref).toBeUndefined()
            expect(f.patch).toContain('+new') // 单文件兜底合成仍出 patch
        } finally {
            await rm(dir, { recursive: true, force: true })
            await rm(outside, { recursive: true, force: true })
        }
    })
})
