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

// transcript 活链读取器（rewind/fork 共用的查询底座，替代 transcriptScan 头部分页扫描族）。
//
// 为什么是反向活链回溯而不是 getSessionMessages 分页：
// SDK 的 getSessionMessages 每次调用都全量加载会话文件再内存切片——分页循环把它
// 放大成 N 次全文件 parse（2026-11-13 实测：283MB transcript 一次 dry-run ≈ 26 次
// 全量 load ≈ 26s+，rewind 不可用）。本模块从文件尾部反向读窗口、沿 parentUuid
// 活链回溯：几何扩窗（首窗 256KB，未命中翻倍，封顶 50MB）使成本 O(回退深度)——
// 常态目标（距尾几 KB～几百 KB）首窗毫秒级命中，深回退按需付最终窗口的 ~2 倍
//（几何级数和）；内存峰值 = 当前窗口，任何路径都不整文件加载。
//
// raw 链即事实源（对齐 Claude Desktop rewind 语义，5.11492.2 逆向）：transcript
// 文件本身就是最终执行截断校验（CLI resumeDropsTurn 归因）读取的东西，SDK 视图
//（compact 时会注入 raw 文件中不存在的合成 entry）反而不是裁判。因此：
// - compact_boundary / attachment 载体 / system 行一律按「跳板」跳过续走——
//   raw 链经它们连续，跨 compact 的回退照常可用；
// - 窗口外目标（深于 50MB）诚实拒绝（not-found），绝不升级为全量 load——
//   几周前的消息本就不该靠 rewind，明确拒绝优于卡死几十秒。

import type { SessionMessage } from '@anthropic-ai/claude-agent-sdk'
import { resolveTranscriptPath } from '@mobi/node-core/claudeSdk/transcriptPath'
import { logger } from '@mobi/node-core/logger'
import { ENVELOPE_TAG } from './crossSessionEnvelope'
import { scanTailLines } from './tailReader'

/** rewind 丢弃区间分析结果（锚点之后到链尾） */
export interface DropRangeAnalysis {
    /** 区间内「轮 prompt」user entry 数——恰为 1 时 rewind 才携带 resumeDropsTurn 守卫 */
    droppedTurns: number
    /** 区间内首条跨会话入站 user entry 的 uuid；无则 null */
    crossSessionEntry: string | null
}

/** analyzeRewindTarget 结果：found（anchor null = 目标是链首）或 not-found */
export type RewindTargetAnalysis =
    | { status: 'found'; anchor: string | null; dropRange: DropRangeAnalysis }
    | { status: 'not-found' }

export interface ChainScanOptions {
    /** 反读窗口字节上限（内存上界），默认 50MB */
    maxBytes?: number
}

/** 首窗字节：常态回退（距尾几 KB～几百 KB）一轮命中，毫秒级 */
const INITIAL_WINDOW_BYTES = 256 * 1024
/** 窗口上限：对齐 Claude Desktop rewind 的尾部窗口量级（mainBytes 50MB） */
const DEFAULT_MAX_BYTES = 50 * 1024 * 1024

// ── 轮数计数谓词（求值时才 parse raw；对非 user entry 恒 false，调用方据此跳过 parse）──

/** 跨会话入站消息的标记前缀（信封 XML 标签单源 crossSessionEnvelope，防两侧字面量漂移） */
const CROSS_SESSION_MARKER = `<${ENVELOPE_TAG}`

/** CC 合成中断标记的已知前缀（归因到被中断的轮，不算新 turn prompt） */
const INTERRUPT_MARKER_RE = /^\[Request (?:interrupted|cancelled)/

/**
 * user entry 是否为跨会话入站消息（content 字符串 / text blocks 两种形态都覆盖；
 * 非字符串 content 一律按「不是」——宽松消费，误判代价由 SDK 归因校验兜底）。
 */
function isCrossSessionEntry(entry: SessionMessage): boolean {
    if (entry.type !== 'user') return false
    const content = (entry.message as { content?: unknown } | null | undefined)?.content
    if (typeof content === 'string') return content.includes(CROSS_SESSION_MARKER)
    if (Array.isArray(content)) {
        return content.some((b) => {
            const text = (b as { text?: unknown } | null)?.text
            return typeof text === 'string' && text.includes(CROSS_SESSION_MARKER)
        })
    }
    return false
}

/**
 * user entry 是否为「轮 prompt」（一个新 turn 的起点）——丢弃区间轮数的计数单位。
 * 归因到所属轮、不算新 turn 的载体：tool_result 载体（数组含 tool_result block）、
 * 合成中断标记。计数偏差方向的不对称代价：低估（漏计真实轮）→ 单轮误判错误携带
 * 守卫 → CLI deterministic 拒绝、rewind 必失败；高估 → 多轮误判省略守卫 → 丢防呆
 * 但回退成功。故无 text block 的非载体形态（如仅图片的截图轮）按 prompt 计。
 */
function isTurnPromptEntry(entry: SessionMessage): boolean {
    if (entry.type !== 'user') return false
    const content = (entry.message as { content?: unknown } | null | undefined)?.content
    if (typeof content === 'string') return !INTERRUPT_MARKER_RE.test(content)
    if (Array.isArray(content)) {
        // tool_result 载体归因到发起 tool_use 的轮
        if (content.some((b) => (b as { type?: unknown } | null)?.type === 'tool_result')) return false
        // 中断标记按 block 逐个比对（标记块未必在数组首位，join 后 ^ 锚会失配）
        return !content.some((b) => {
            if ((b as { type?: unknown } | null)?.type !== 'text') return false
            const text = (b as { text?: unknown }).text
            return typeof text === 'string' && INTERRUPT_MARKER_RE.test(text)
        })
    }
    return false
}

/** 计数谓词只消费 user 行（读取层对 user 恒留 raw）——非 user 行无需 parse raw */
function isCountableEntry(entry: TailEntry): entry is TailEntry & { raw: string } {
    return entry.type === 'user'
}

// ── 反向窗口读 + 活链回溯（唯一数据通路，零兜底）──

/** 窗口内候选行的最小化留档（只留链回溯与计数所需字段；内存上界 = 窗口字节） */
interface TailEntry {
    uuid: string
    parentUuid: string | null
    type: string
    isSidechain?: boolean
    teamName?: string
    /** 原始 jsonl 行——仅 user/assistant 保留（计数时再完整 parse user 行）；
     *  attachment/system 等跳板行永远不求值，不留 raw 省内存 */
    raw?: string
}

/** 未命中原因（仅进 debug 日志，调用方语义统一为 not-found） */
type NotFoundReason =
    /** 链首走完（parentUuid 空 + 已到文件头）仍未命中——确定性不在链上 */
    | 'chain-head'
    /** 窗口边缘 / 链在窗口内断开——深于窗口预算，诚实拒绝 */
    | 'window-limit'
    /** 窗口内无主线消息（空文件 / 全记账行） */
    | 'no-live-leaf'
    /** 读取异常 */
    | 'read-error'
    /** transcript 路径解析失败（会话无文件） */
    | 'path-unresolved'

type ChainScanOutcome =
    /** dropEntries = 丢弃区间成员（含目标，new→old 文件序 = leaf→目标）；anchor null = 目标是链首 */
    | { outcome: 'found'; anchor: string | null; dropEntries: TailEntry[] }
    | { outcome: 'not-found'; reason: NotFoundReason }

/**
 * 反向读尾部窗口并沿 parentUuid 活链回溯，几何扩窗：首窗 256KB，walk 未命中且
 * 未读满预算时窗口翻倍重扫，封顶 maxBytes。重扫成本几何级数（≈ 最终窗口 2 倍），
 * 常态目标首窗命中即返回。窗口 I/O / 半行切分 / 指纹防护（ino:mtimeMs:size 前后
 * 校验，变化重扫一次）由 tailReader 通用原语承担——与 bridge 订阅者（goal/wakeup
 * 通道）同一底座。
 */
async function reverseChainScan(
    filePath: string,
    nativeId: string,
    maxBytes: number,
): Promise<ChainScanOutcome> {
    let windowBytes = Math.min(INITIAL_WINDOW_BYTES, maxBytes)
    for (;;) {
        let loaded: Awaited<ReturnType<typeof readTailWindow>>
        try {
            loaded = await readTailWindow(filePath, windowBytes)
        } catch (e) {
            logger.debug('[transcriptChain] tail scan failed', e)
            return { outcome: 'not-found', reason: 'read-error' }
        }
        const outcome = walkLiveChain(loaded.entries, loaded.headReached, nativeId)
        if (outcome.outcome === 'found') return outcome
        // 已读文件头（not-found 是确定性的）或窗口已到预算上限（诚实拒绝）→ 终止
        if (loaded.headReached || windowBytes >= maxBytes) return outcome
        windowBytes = Math.min(windowBytes * 2, maxBytes)
    }
}

/**
 * 读取尾部窗口：只保留链回溯相关行的最小留档（半行切分/精确行边界判定由
 * tailReader 承担）。
 */
async function readTailWindow(
    filePath: string,
    windowBytes: number,
): Promise<{ entries: TailEntry[]; headReached: boolean }> {
    const scan = await scanTailLines(filePath, { maxWindow: windowBytes })
    const entries: TailEntry[] = []
    for (const line of scan.lines) {
        let parsed: Record<string, unknown>
        try {
            parsed = JSON.parse(line) as Record<string, unknown>
        } catch {
            continue
        }
        const type = parsed.type
        // 无 uuid 的记账行（custom-title/atis-latch/…）不参与链回溯，直接弃；
        // attachment/progress/system 虽不作锚/不计轮，但可能是链上的跳板
        //（parentUuid 可指向它们，2026-11-13 实测 compact 后形态），必须留档
        // 供回溯续走
        const uuid = parsed.uuid
        if (typeof type !== 'string' || typeof uuid !== 'string' || uuid.length === 0) continue
        const isMessage = type === 'user' || type === 'assistant'
        if (!isMessage && type !== 'attachment' && type !== 'progress' && type !== 'system') continue
        entries.push({
            uuid,
            parentUuid: typeof parsed.parentUuid === 'string' ? parsed.parentUuid : null,
            type,
            isSidechain: parsed.isSidechain === true,
            teamName: typeof parsed.teamName === 'string' ? parsed.teamName : undefined,
            raw: isMessage ? line : undefined,
        })
    }
    return { entries, headReached: !scan.truncated }
}

/**
 * 活链回溯：leaf = 窗口内文件序最后一条主线 user/assistant entry（对齐 SDK 视图
 * 的 leaf 判定：排除 sidechain/team；记账行已在读取层弃掉）。沿 parentUuid 向旧走，
 * 直至命中目标（再前探一条 user/assistant 作锚）、链首（未命中，确定性）、或窗口
 * 边缘（由调用方扩窗/诚实拒绝）。attachment/system（含 compact_boundary）等非消息
 * 行一律按跳板跳过续走——raw 链经它们连续，跨 compact 的回退照常可用。
 */
function walkLiveChain(entries: TailEntry[], headReached: boolean, nativeId: string): ChainScanOutcome {
    const byUuid = new Map(entries.map((e) => [e.uuid, e]))

    // 叶子：从文件序末尾向前找第一条主线消息（记账行已滤掉；sidechain/team 不算）
    let leaf: TailEntry | undefined
    for (let i = entries.length - 1; i >= 0; i--) {
        const e = entries[i]!
        if ((e.type === 'user' || e.type === 'assistant') && !e.isSidechain && !e.teamName) {
            leaf = e
            break
        }
    }
    if (!leaf) return { outcome: 'not-found', reason: 'no-live-leaf' }

    /** 跳板推进：cur 若非 user/assistant，沿 parentUuid 续走直到消息行或链尽。
     *  步数上界 = 窗口行数：正常路径每行至多经过一次，超出即数据自环，按链尽处理 */
    const stepPastSpringboard = (cur: TailEntry | undefined): TailEntry | undefined => {
        for (let steps = 0; cur && steps <= entries.length; steps++) {
            if (cur.type === 'user' || cur.type === 'assistant') return cur
            cur = cur.parentUuid ? byUuid.get(cur.parentUuid) : undefined
        }
        return undefined
    }

    // 收集链成员（new→old：leaf 到目标，含目标——目标是丢弃区间首个计轮成员），
    // 命中即停
    const collected: TailEntry[] = []
    const visited = new Set<string>()
    let cur: TailEntry | undefined = leaf
    let target: TailEntry | null = null
    while (cur) {
        if (visited.has(cur.uuid)) break
        visited.add(cur.uuid)
        collected.push(cur)
        if (cur.uuid === nativeId) {
            target = cur
            break
        }
        cur = stepPastSpringboard(cur.parentUuid ? byUuid.get(cur.parentUuid) : undefined)
    }

    if (!target) {
        // 未命中：链首走完（parentUuid 空）且已到文件头才算确定性 not-found；
        // 其余（窗口边缘 / 窗口内断链）按窗口外诚实拒绝
        const oldest = collected[collected.length - 1]
        if (oldest && oldest.parentUuid === null && headReached) {
            return { outcome: 'not-found', reason: 'chain-head' }
        }
        return { outcome: 'not-found', reason: 'window-limit' }
    }

    // 命中后前探锚：最近一条更旧的 user/assistant（同样跳过跳板行，一步到位）。
    // 锚 null = 目标是链首，调用方按 /clear 引导拒绝（2026-09-21 事故不变量：
    // 锚取目标前最近 user/assistant，使截断区间第一条恰为声明的 turn prompt）
    let anchor: string | null = null
    if (target.parentUuid) {
        const anchorEntry = stepPastSpringboard(byUuid.get(target.parentUuid))
        anchor = anchorEntry?.uuid ?? null
    }
    return { outcome: 'found', anchor, dropEntries: collected }
}

/**
 * rewind 目标分析（一次回溯同时产出锚点 + 丢弃区间，替代 findRewindAnchor +
 * analyzeDropRange 两趟头部扫描）。目标不在活链 / 深于窗口预算 / 链首目标
 * （anchor null）由调用方按 ANCHOR_REJECT 语义处理。
 */
export async function analyzeRewindTarget(
    sessionId: string,
    dir: string,
    nativeId: string,
    opts?: ChainScanOptions,
): Promise<RewindTargetAnalysis> {
    const startedAt = Date.now()
    const scan = await scanLiveChain(sessionId, dir, nativeId, opts?.maxBytes ?? DEFAULT_MAX_BYTES)
    if (scan.outcome !== 'found') {
        logger.debug(`[transcriptChain] not-found (${scan.reason}) in ${Date.now() - startedAt}ms (target=${nativeId.slice(0, 8)})`)
        return { status: 'not-found' }
    }

    // 丢弃区间计数（dropEntries 已是目标→leaf 的链成员，锚的语义由 walk 承载）：
    // 只 parse user 行——两个计数谓词对非 user entry 恒 false，assistant 行的
    // parse 纯属浪费（assistant 通常占窗口字节大头）
    let droppedTurns = 0
    let crossSessionEntry: string | null = null
    for (const entry of scan.dropEntries) {
        if (!isCountableEntry(entry)) continue
        const message = JSON.parse(entry.raw) as SessionMessage
        if (isCrossSessionEntry(message)) {
            crossSessionEntry ??= entry.uuid
            continue
        }
        if (isTurnPromptEntry(message)) droppedTurns++
    }

    logger.debug(`[transcriptChain] fast path hit in ${Date.now() - startedAt}ms (target=${nativeId.slice(0, 8)})`)
    return { status: 'found', anchor: scan.anchor, dropRange: { droppedTurns, crossSessionEntry } }
}

/**
 * fork 激活预检的存在性判定（替代 scanTranscriptForUuid 纯存在性快路径）：
 * uuid 是否在活链上。纯 walk 判定，零 raw parse。窗口外 / 不在链 → false
 *（与 rewind 同底座同语义）。
 */
export async function chainContains(
    sessionId: string,
    dir: string,
    uuid: string,
    opts?: ChainScanOptions,
): Promise<boolean> {
    const scan = await scanLiveChain(sessionId, dir, uuid, opts?.maxBytes ?? DEFAULT_MAX_BYTES)
    return scan.outcome === 'found'
}

async function scanLiveChain(
    sessionId: string,
    dir: string,
    target: string,
    maxBytes: number,
): Promise<ChainScanOutcome> {
    const resolved = resolveTranscriptPath(sessionId, dir)
    if (!resolved.ok) return { outcome: 'not-found', reason: 'path-unresolved' }
    return reverseChainScan(resolved.path, target, maxBytes)
}
