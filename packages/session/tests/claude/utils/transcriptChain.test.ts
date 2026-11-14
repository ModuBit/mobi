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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { analyzeRewindTarget, chainContains } from '../../../src/claude/utils/transcriptChain'

vi.mock('@mobi/node-core/logger', () => ({
    logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

// ── fixture：真实落盘 jsonl（走真实文件 I/O，零 mock；v4 无 SDK 兜底通路）──

let configDir: string
const WORK_DIR = '/work/proj'
const SESSION_ID = 'sess-chain-1'

/** 最小 user entry（content 字符串形态） */
function userMsg(uuid: string, text: string, extra: Record<string, unknown> = {}) {
    return { type: 'user', uuid, message: { content: text }, ...extra }
}

/** 工具结果载体 user entry（归因到所属轮，不计入轮数） */
function toolResultMsg(uuid: string) {
    return { type: 'user', uuid, message: { content: [{ type: 'tool_result', content: 'ok' }] } }
}

/** 中断标记 user entry（真实形态：text blocks 数组） */
function interruptMarker(uuid: string, text = '[Request interrupted by user]') {
    return { type: 'user', uuid, message: { content: [{ type: 'text', text }] } }
}

function assistantMsg(uuid: string) {
    return { type: 'assistant', uuid, message: { content: [] } }
}

/** 跨会话入站消息（2026-09-29 事故实录形态） */
function crossSessionMsg(uuid: string) {
    return { type: 'user', uuid, message: { content: '<cross-session-message from-name="其他会话">hi</cross-session-message>' } }
}

/** 记账行（atis-latch / custom-title 等，非消息链成员，常落在文件尾部） */
function bookkeepingLine(kind = 'atis-latch') {
    return { type: kind, at: Date.now() }
}

interface WriteOpts {
    /** 显式 parentUuid 覆写表（uuid → parentUuid）；缺省按落盘顺序自动链接 */
    parents?: Record<string, string | null>
    /** 追加在末尾但不参与自动链接的行（记账行等） */
    tailLines?: unknown[]
}

/**
 * 把 entry 序列落盘成 transcript jsonl。自动链接规则：每条消息 entry 的
 * parentUuid 指向前一条消息 entry（链式）；首条为 null（链首）。
 */
function writeTranscript(entries: Array<Record<string, unknown>>, opts: WriteOpts = {}) {
    const dir = join(configDir, 'projects', '-work-proj')
    mkdirSync(dir, { recursive: true })
    const lines: string[] = []
    let prev: string | null = null
    for (const e of entries) {
        const uuid = e.uuid as string
        const parent = uuid in (opts.parents ?? {}) ? opts.parents?.[uuid] : prev
        lines.push(JSON.stringify({ ...e, parentUuid: parent ?? undefined }))
        prev = uuid
    }
    for (const t of opts.tailLines ?? []) lines.push(JSON.stringify(t))
    writeFileSync(join(dir, `${SESSION_ID}.jsonl`), lines.join('\n') + '\n')
}

beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), 'mobi-chain-'))
    process.env.CLAUDE_CONFIG_DIR = configDir
})

afterEach(() => {
    delete process.env.CLAUDE_CONFIG_DIR
    rmSync(configDir, { recursive: true, force: true })
})

describe('analyzeRewindTarget（反向活链回溯）', () => {
    it('常态：锚 = 目标前最近 user/assistant，区间 = 目标→叶子', async () => {
        writeTranscript([
            userMsg('u1', '第一轮'),
            assistantMsg('a1'),
            userMsg('target', '回退我'),
            assistantMsg('a2'),
        ], { tailLines: [bookkeepingLine(), bookkeepingLine('custom-title')] })

        await expect(analyzeRewindTarget(SESSION_ID, WORK_DIR, 'target')).resolves.toEqual({
            status: 'found',
            anchor: 'a1',
            dropRange: { droppedTurns: 1, crossSessionEntry: null },
        })
    })

    it('被中断轮：tool_result 载体 / 中断标记归因所属轮 → droppedTurns 1，锚取中断标记', async () => {
        writeTranscript([
            userMsg('u0', '前一轮'),
            assistantMsg('a-mid'),
            toolResultMsg('tr-1'),
            interruptMarker('im-1'),
            userMsg('target', '用 Bash 运行 sleep 90'),
            assistantMsg('tu-1'),
        ])

        await expect(analyzeRewindTarget(SESSION_ID, WORK_DIR, 'target')).resolves.toEqual({
            status: 'found',
            anchor: 'im-1',
            dropRange: { droppedTurns: 1, crossSessionEntry: null },
        })
    })

    it('多轮区间 → droppedTurns 如实计数', async () => {
        writeTranscript([
            userMsg('u1', '第一轮'),
            assistantMsg('a1'),
            userMsg('target', '回退我'),
            assistantMsg('a2'),
            userMsg('next-turn', '第二轮'),
            assistantMsg('a3'),
        ])

        await expect(analyzeRewindTarget(SESSION_ID, WORK_DIR, 'target')).resolves.toEqual({
            status: 'found',
            anchor: 'a1',
            dropRange: { droppedTurns: 2, crossSessionEntry: null },
        })
    })

    it('区间含死分支 user 行 → 文件序口径一并计数（CLI 截断按位置切，活链计数会低估）', async () => {
        // target 在活链上（a2 → target），锚 a1 与 target 之间文件序夹着死分支行：
        // CLI resumeDropsTurn 归因读的物理区间 [a1 之后..文件尾] 会把它一并丢弃
        writeTranscript([
            userMsg('u1', '第一轮'),
            assistantMsg('a1'),
            userMsg('dead-branch', '被放弃的分叉'),
            userMsg('target', '回退我'),
            assistantMsg('a2'),
        ], { parents: { 'dead-branch': 'a1', target: 'a1' } })

        await expect(analyzeRewindTarget(SESSION_ID, WORK_DIR, 'target')).resolves.toEqual({
            status: 'found',
            anchor: 'a1',
            dropRange: { droppedTurns: 2, crossSessionEntry: null },
        })
    })

    it('区间含跨会话条目 → 不计轮但 crossSessionEntry 透出', async () => {
        writeTranscript([
            userMsg('anchor-prev', '前一轮'),
            assistantMsg('a1'),
            userMsg('target', '回退我'),
            crossSessionMsg('cs-1'),
        ])

        await expect(analyzeRewindTarget(SESSION_ID, WORK_DIR, 'target')).resolves.toEqual({
            status: 'found',
            anchor: 'a1',
            dropRange: { droppedTurns: 1, crossSessionEntry: 'cs-1' },
        })
    })

    it('用户消息只是引用信封字面量（不在开头）→ 不误判跨会话、正常计轮', async () => {
        // 真实跨会话行的 content 恒以信封开头；文中引用/粘贴通常带前置文字或代码块，
        // 开头锚定把这类误判压掉（误判会把正常轮标成跨会话、污染守卫判定）
        writeTranscript([
            assistantMsg('a1'),
            userMsg('target', '回退我'),
            userMsg('quote', '看我引用 <cross-session-message from-name="x">hi</cross-session-message> 完事'),
            assistantMsg('a2'),
        ])

        await expect(analyzeRewindTarget(SESSION_ID, WORK_DIR, 'target')).resolves.toEqual({
            status: 'found',
            anchor: 'a1',
            dropRange: { droppedTurns: 2, crossSessionEntry: null },
        })
    })

    it('上一 turn 被打断（尾随 tool_result / 中断标记）→ 锚取目标前最近 user/assistant（2026-09-21 事故不变量）', async () => {
        writeTranscript([
            userMsg('u0', '前一轮'),
            assistantMsg('a-mid'),
            toolResultMsg('tool-result'),
            interruptMarker('interrupted'),
            userMsg('target', '回退我'),
        ])

        const result = await analyzeRewindTarget(SESSION_ID, WORK_DIR, 'target')
        expect(result).toEqual({
            status: 'found',
            anchor: 'interrupted',
            dropRange: expect.any(Object),
        })
    })

    it('目标紧邻前驱是上一轮 user prompt → 直接作锚（截断区间以目标开头）', async () => {
        writeTranscript([
            assistantMsg('a-pre'),
            userMsg('other-user', '上一轮'),
            userMsg('target', '回退我'),
        ])

        const result = await analyzeRewindTarget(SESSION_ID, WORK_DIR, 'target')
        expect(result.status).toBe('found')
        if (result.status !== 'found') return
        expect(result.anchor).toBe('other-user')
    })

    it('仅图片的截图轮（无 text block 非载体）→ 计入轮数（低估会让守卫误携，CLI 必拒）', async () => {
        writeTranscript([
            assistantMsg('a1'),
            userMsg('target', '回退我'),
            { type: 'user', uuid: 'img-turn', message: { content: [{ type: 'image', source: { type: 'base64' } }] } },
        ])

        const result = await analyzeRewindTarget(SESSION_ID, WORK_DIR, 'target')
        expect(result.status).toBe('found')
        if (result.status !== 'found') return
        expect(result.dropRange.droppedTurns).toBe(2)
    })

    it('中断标记 text block 不在数组首位 → 仍识别为标记不计轮', async () => {
        writeTranscript([
            assistantMsg('a1'),
            userMsg('target', '回退我'),
            { type: 'user', uuid: 'mk-late', message: { content: [
                { type: 'text', text: '前置说明' },
                { type: 'text', text: '[Request cancelled by user]' },
            ] } },
        ])

        const result = await analyzeRewindTarget(SESSION_ID, WORK_DIR, 'target')
        expect(result.status).toBe('found')
        if (result.status !== 'found') return
        expect(result.dropRange.droppedTurns).toBe(1)
    })

    it('assistant entry 内容含跨会话标记不命中（只查 user entry）', async () => {
        writeTranscript([
            userMsg('anchor-prev', 'x'),
            assistantMsg('a1'),
            userMsg('target', '回退我'),
            { type: 'assistant', uuid: 'fake-a', message: { content: '<cross-session-message>x</cross-session-message>' } },
        ])

        const result = await analyzeRewindTarget(SESSION_ID, WORK_DIR, 'target')
        expect(result.status).toBe('found')
        if (result.status !== 'found') return
        expect(result.dropRange.crossSessionEntry).toBeNull()
    })

    it('目标在死分支上（不在活链）→ not-found（链首走完的确定性判定）', async () => {
        // 死分支的真实形态：从 a1 分叉后又被放弃，活链随后继续追加在 a1 之下
        //（CC 语义 latest-append-wins：文件序最后的分支才是活链）
        writeTranscript([
            userMsg('u1', '第一轮'),
            assistantMsg('a1'),
            userMsg('dead-branch', '被放弃的分叉'),
            userMsg('u2', '活链续行'),
            assistantMsg('a2'),
        ], { parents: { 'dead-branch': 'a1', 'u2': 'a1', 'a2': 'u2' } })

        await expect(analyzeRewindTarget(SESSION_ID, WORK_DIR, 'dead-branch')).resolves.toEqual({ status: 'not-found', cause: 'absent' })
    })

    it('sidechain entry 不作叶子、不入链', async () => {
        const dir = join(configDir, 'projects', '-work-proj')
        mkdirSync(dir, { recursive: true })
        writeFileSync(join(dir, `${SESSION_ID}.jsonl`), [
            JSON.stringify({ ...userMsg('u1', '第一轮'), parentUuid: null }),
            JSON.stringify({ ...assistantMsg('a1'), parentUuid: 'u1' }),
            JSON.stringify({ ...userMsg('target', '回退我'), parentUuid: 'a1' }),
            // sidechain 挂在 a1 之后落盘（文件序更晚），但活链叶子仍是 target
            JSON.stringify({ ...userMsg('side-1', '子代理消息'), parentUuid: 'a1', isSidechain: true }),
        ].join('\n') + '\n')

        const result = await analyzeRewindTarget(SESSION_ID, WORK_DIR, 'target')
        expect(result.status).toBe('found')
        if (result.status !== 'found') return
        expect(result.anchor).toBe('a1')
        // sidechain 不入丢弃区间（SDK 活链视图同语义）
        expect(result.dropRange.droppedTurns).toBe(1)
    })

    it('链上 parentUuid 指向 attachment 载体行（跳板）→ 回溯跳过续走仍命中（2026-11-13 compact 后实录形态）', async () => {
        const dir = join(configDir, 'projects', '-work-proj')
        mkdirSync(dir, { recursive: true })
        writeFileSync(join(dir, `${SESSION_ID}.jsonl`), [
            JSON.stringify({ ...userMsg('u1', '第一轮'), parentUuid: null }),
            JSON.stringify({ ...assistantMsg('a1'), parentUuid: 'u1' }),
            // attachment 载体挂在 a1 之后，下一条 user 的 parent 指向它而非 a1
            JSON.stringify({ type: 'attachment', uuid: 'att-1', attachment: { type: 'file' }, parentUuid: 'a1' }),
            JSON.stringify({ ...userMsg('target', '回退我'), parentUuid: 'att-1' }),
            JSON.stringify({ ...assistantMsg('a2'), parentUuid: 'target' }),
        ].join('\n') + '\n')

        const result = await analyzeRewindTarget(SESSION_ID, WORK_DIR, 'target')
        expect(result).toEqual({
            status: 'found',
            // 锚跳过 attachment 跳板取 a1
            anchor: 'a1',
            dropRange: { droppedTurns: 1, crossSessionEntry: null },
        })
    })

    it('目标是链首 → found + anchor null（调用方按 /clear 引导拒绝）', async () => {
        writeTranscript([
            userMsg('target', '链首消息'),
            assistantMsg('a1'),
        ])

        await expect(analyzeRewindTarget(SESSION_ID, WORK_DIR, 'target')).resolves.toEqual({
            status: 'found',
            anchor: null,
            dropRange: { droppedTurns: 1, crossSessionEntry: null },
        })
    })

    it('目标不存在（假锚点）→ not-found（链首确定性判定）', async () => {
        writeTranscript([userMsg('u1', '第一轮'), assistantMsg('a1')])

        await expect(analyzeRewindTarget(SESSION_ID, WORK_DIR, 'ghost')).resolves.toEqual({ status: 'not-found', cause: 'absent' })
    })

    it('transcript 文件不存在 → not-found + unavailable（与「锚点不在」的确定性拒绝分开报）', async () => {
        await expect(analyzeRewindTarget('no-such-session', WORK_DIR, 'u1')).resolves.toEqual({ status: 'not-found', cause: 'unavailable' })
    })
})

describe('analyzeRewindTarget（compact 边界：跳板语义，raw 链即事实源）', () => {
    it('回溯跨 compact_boundary → 跳板跳过续走，跨边界回退照常可用', async () => {
        // raw 链连续：a2 → post-compact → cb-1(跳板) → a1 → target → a0 → u0。
        // SDK 视图在 compact 处做 preserved 拼接并注入合成 entry，raw 链不需要——
        // CLI resumeDropsTurn 归因校验读的就是这个文件（v4 事实源口径）
        writeTranscript([
            userMsg('u0', '压缩前'),
            assistantMsg('a0'),
            userMsg('target', '回退我'),
            assistantMsg('a1'),
            { type: 'system', uuid: 'cb-1', subtype: 'compact_boundary' },
            userMsg('post-compact', '压缩后'),
            assistantMsg('a2'),
        ])

        await expect(analyzeRewindTarget(SESSION_ID, WORK_DIR, 'target')).resolves.toEqual({
            status: 'found',
            anchor: 'a0',
            // 区间 [target..a2] 含压缩后一轮（post-compact）——与旧 analyzeDropRange 同口径
            dropRange: { droppedTurns: 2, crossSessionEntry: null },
        })
    })

    it('锚前探跨 compact_boundary（目标紧跟边界后）→ 跳板取到压缩前最后一条消息', async () => {
        // compact 后首条 user 的锚 = 压缩前链尾（raw 链口径），不是 boundary 行
        writeTranscript([
            userMsg('u0', '压缩前'),
            assistantMsg('pre-tail'),
            { type: 'system', uuid: 'cb-1', subtype: 'compact_boundary' },
            userMsg('target', '压缩后首条'),
            assistantMsg('a2'),
        ])

        await expect(analyzeRewindTarget(SESSION_ID, WORK_DIR, 'target')).resolves.toEqual({
            status: 'found',
            anchor: 'pre-tail',
            dropRange: { droppedTurns: 1, crossSessionEntry: null },
        })
    })

    it('窗口内存在孤儿 compact_boundary（不在回溯路径上）→ 不影响命中', async () => {
        const dir = join(configDir, 'projects', '-work-proj')
        mkdirSync(dir, { recursive: true })
        // 活链不经过 boundary 行（孤儿边界行，parentUuid 空）
        writeFileSync(join(dir, `${SESSION_ID}.jsonl`), [
            JSON.stringify({ ...userMsg('u1', '第一轮'), parentUuid: null }),
            JSON.stringify({ ...assistantMsg('a1'), parentUuid: 'u1' }),
            JSON.stringify({ ...userMsg('target', '回退我'), parentUuid: 'a1' }),
            JSON.stringify({ type: 'system', uuid: 'cb-orphan', subtype: 'compact_boundary', parentUuid: null }),
            JSON.stringify({ ...assistantMsg('a2'), parentUuid: 'target' }),
        ].join('\n') + '\n')

        await expect(analyzeRewindTarget(SESSION_ID, WORK_DIR, 'target')).resolves.toEqual({
            status: 'found',
            anchor: 'a1',
            dropRange: { droppedTurns: 1, crossSessionEntry: null },
        })
    })
})

describe('analyzeRewindTarget（窗口预算：诚实拒绝，零全量 load）', () => {
    it('预算耗尽（窗口装不下目标）→ not-found，不升级为全量加载', async () => {
        writeTranscript([
            userMsg('u1', '第一轮'),
            assistantMsg('a1'),
            userMsg('target', '回退我'),
            assistantMsg('a2'),
        ])

        // 10 字节窗口只够读到尾部半行——目标在窗口外，诚实拒绝
        await expect(analyzeRewindTarget(SESSION_ID, WORK_DIR, 'target', { maxBytes: 10 })).resolves.toEqual({ status: 'not-found', cause: 'absent' })
    })

    it('链在窗口内断开（parent 指向窗口外）→ not-found（window-limit）', async () => {
        const dir = join(configDir, 'projects', '-work-proj')
        mkdirSync(dir, { recursive: true })
        // 头部两条小行 + 20KB 大尾巴：2KB 窗口只装得下大尾巴的尾部（首段半行丢弃），
        // 回溯从 big-tail 起步即断（parent 指向窗口外）——按窗口外诚实拒绝
        writeFileSync(join(dir, `${SESSION_ID}.jsonl`), [
            JSON.stringify({ ...userMsg('target', '很老的消息'), parentUuid: null }),
            JSON.stringify({ ...assistantMsg('a0'), parentUuid: 'target' }),
        ].join('\n') + '\n')
        appendLine(dir, { type: 'assistant', uuid: 'big-tail', message: { content: 'x'.repeat(20 * 1024) }, parentUuid: 'a0' })

        await expect(analyzeRewindTarget(SESSION_ID, WORK_DIR, 'target', { maxBytes: 2 * 1024 })).resolves.toEqual({ status: 'not-found', cause: 'absent' })
    })

    it('目标在窗内但锚前驱走不通（窗外/断链）→ not-found（window-limit），绝不误报 found+anchor null 伪装链首', async () => {
        // 目标的 parentUuid 指向不存在的行（窗外/断链的超集形态）：锚前探失败必须
        // 走 window-limit 扩窗/拒绝，而非 anchor null——后者会让调用方给出 /clear
        // 引导的错文案（#1：锚前驱窗外≠目标是链首）
        writeTranscript([
            userMsg('u1', '第一轮'),
            assistantMsg('a1'),
            userMsg('target', '回退我'),
            assistantMsg('a2'),
        ], { parents: { target: 'ghost-parent' } })

        await expect(analyzeRewindTarget(SESSION_ID, WORK_DIR, 'target')).resolves.toEqual({ status: 'not-found', cause: 'absent' })
    })

    it('目标紧邻锚、锚前驱是窗外 attachment 跳板 → 扩窗后仍断则诚实拒绝', async () => {
        // 跳板行的 parentUuid 空（compact_boundary 实测形态：raw 链物理断开）——
        // 锚前探经跳板走到链尽，按 window-limit 拒绝（与 CLI resume 裁判同语义）
        writeTranscript([
            userMsg('u1', '压缩前'),
            assistantMsg('a1'),
            { type: 'system', uuid: 'cb-1', subtype: 'compact_boundary' },
            userMsg('target', '边界后首条'),
            assistantMsg('a2'),
        ], { parents: { 'cb-1': null, target: 'cb-1' } })

        await expect(analyzeRewindTarget(SESSION_ID, WORK_DIR, 'target')).resolves.toEqual({ status: 'not-found', cause: 'absent' })
    })
})

describe('chainContains（fork 激活预检：窗口内存在性，不走活链）', () => {
    it('uuid 在活链上 → found', async () => {
        writeTranscript([
            userMsg('u1', '第一轮'),
            assistantMsg('anchor'),
            userMsg('u2', '第二轮'),
            assistantMsg('a2'),
        ])

        await expect(chainContains(SESSION_ID, WORK_DIR, 'anchor')).resolves.toEqual({ found: true })
    })

    it('uuid 在死分支上（文件中存在、活链不可达）→ 仍 found（fork 锚点按文件存在性判定）', async () => {
        writeTranscript([
            userMsg('u1', '第一轮'),
            assistantMsg('a1'),
            userMsg('dead-branch', '被放弃的分叉'),
            userMsg('u2', '活链续行'),
            assistantMsg('a2'),
        ], { parents: { 'dead-branch': 'a1', u2: 'a1' } })

        await expect(chainContains(SESSION_ID, WORK_DIR, 'dead-branch')).resolves.toEqual({ found: true })
    })

    it('uuid 不在（假锚点 / 已被 rewind 丢弃）→ absent', async () => {
        writeTranscript([userMsg('u1', '第一轮'), assistantMsg('a1')])

        await expect(chainContains(SESSION_ID, WORK_DIR, 'gone')).resolves.toEqual({ found: false, cause: 'absent' })
    })

    it('文件不存在 → unavailable（parent transcript 丢失，与「不在」分开报）', async () => {
        await expect(chainContains('no-such-session', WORK_DIR, 'x')).resolves.toEqual({ found: false, cause: 'unavailable' })
    })

    it('深于窗口预算 → absent（诚实拒绝，与 rewind 同底座）', async () => {
        writeTranscript([userMsg('u1', '第一轮'), assistantMsg('a1')])

        await expect(chainContains(SESSION_ID, WORK_DIR, 'a1', { maxBytes: 10 })).resolves.toEqual({ found: false, cause: 'absent' })
    })
})

/** 追加单行到既有 transcript（不重写全文件） */
function appendLine(dir: string, entry: Record<string, unknown>) {
    const filePath = join(dir, `${SESSION_ID}.jsonl`)
    writeFileSync(filePath, `${readFileSync(filePath, 'utf-8')}${JSON.stringify(entry)}\n`)
}
