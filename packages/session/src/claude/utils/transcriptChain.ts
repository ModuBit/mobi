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
// 全量 load ≈ 26s+，rewind 不可用）。本模块从文件尾部反向分块读、沿 parentUuid
// 活链回溯：成本 O(回退深度)（常态几十 KB、毫秒级），与文件总量无关；内存上限
// = 窗口字节预算（默认 50MB），任何路径都不整文件加载。
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

/** 默认窗口预算：对齐 Claude Desktop rewind 的尾部窗口量级（mainBytes 50MB） */
const DEFAULT_MAX_BYTES = 50 * 1024 * 1024
/** 反向分块单块字节数 */
const CHUNK_SIZE = 64 * 1024

// ── 轮数计数谓词（自 transcriptScan 原样迁入，语义零漂移）──

/** 跨会话入站消息在 transcript 里的标记前缀（CC 原生 SendMessage 写入的 user entry 载体） */
const CROSS_SESSION_MARKER = '<cross-session-message'

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

/**
 * 在「旧→新」的链条目上推导 rewind 锚点与丢弃区间。
 *
 * - anchor：目标前最近一条 user/assistant entry 的 uuid（resumeSessionAt 保留锚；
 *   链首 → null，调用方按拒绝处理）。system/attachment 等不作锚（2026-09-21 事故
 *   不变量：锚取目标前最近 user/assistant，使截断区间第一条恰为声明的 turn prompt）
 * - dropRange：anchor 之后（含目标）的区间计数，与旧 analyzeDropRange(anchor) 同口径
 * - 返回 null 仅当链不含目标（调用方扫描已命中才传入，防御分支）
 */
function analyzeChainEntries(
    entries: SessionMessage[],
    nativeId: string,
): { anchor: string | null; dropRange: DropRangeAnalysis } | null {
    const idx = entries.findIndex((e) => e.uuid === nativeId)
    if (idx < 0) return null
    let anchorIdx = -1
    for (let i = idx - 1; i >= 0; i--) {
        const t = entries[i].type
        if (t === 'user' || t === 'assistant') {
            anchorIdx = i
            break
        }
    }
    let droppedTurns = 0
    let crossSessionEntry: string | null = null
    for (let i = anchorIdx + 1; i < entries.length; i++) {
        const entry = entries[i]
        if (isCrossSessionEntry(entry)) {
            crossSessionEntry ??= entry.uuid
            continue
        }
        if (isTurnPromptEntry(entry)) droppedTurns++
    }
    return {
        anchor: anchorIdx >= 0 ? entries[anchorIdx].uuid : null,
        dropRange: { droppedTurns, crossSessionEntry },
    }
}

// ── 反向窗口读 + 活链回溯（唯一数据通路，零兜底）──

/** 窗口内候选行的最小化留档（只留链回溯所需字段；内存上界 = 窗口字节） */
interface TailEntry {
    uuid: string
    parentUuid: string | null
    type: string
    isSidechain?: boolean
    teamName?: string
    /** 原始 jsonl 行——仅 user/assistant 保留（链成员求值谓词时再完整 parse）；
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
    /** 读取异常（含重扫一次仍指纹不稳） */
    | 'read-error'
    /** transcript 路径解析失败（会话无文件） */
    | 'path-unresolved'

type ChainScanOutcome =
    | { outcome: 'found'; chain: SessionMessage[] }
    | { outcome: 'not-found'; reason: NotFoundReason }

/**
 * 反向分块读文件尾部窗口并沿 parentUuid 活链回溯。窗口 I/O / 半行切分 / 指纹防护
 *（ino:mtimeMs:size 前后校验，变化重扫一次；并发追加无害：读位置锚定开扫时捕获的
 * EOF，截断/重写才触发指纹变化）由 tailReader 通用原语承担——与 bridge 订阅者
 *（goal/wakeup 通道）同一底座。
 */
async function reverseChainScan(
    filePath: string,
    nativeId: string,
    maxBytes: number,
): Promise<ChainScanOutcome> {
    let loaded: Awaited<ReturnType<typeof readTailWindow>>
    try {
        loaded = await readTailWindow(filePath, maxBytes)
    } catch (e) {
        logger.debug('[transcriptChain] tail scan failed', e)
        return { outcome: 'not-found', reason: 'read-error' }
    }
    return walkLiveChain(loaded.entries, loaded.headReached, nativeId)
}

/**
 * 读取尾部窗口：只保留链回溯相关行的最小留档（半行切分/精确行边界判定由
 * tailReader 承担）。
 */
async function readTailWindow(
    filePath: string,
    maxBytes: number,
): Promise<{ entries: TailEntry[]; headReached: boolean }> {
    const scan = await scanTailLines(filePath, { chunkSize: CHUNK_SIZE, maxWindow: maxBytes })
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
 * 边缘（诚实拒绝）。attachment/system（含 compact_boundary）等非消息行一律按跳板
 * 跳过续走——raw 链经它们连续，跨 compact 的回退照常可用。
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
        let steps = 0
        while (cur && cur.type !== 'user' && cur.type !== 'assistant' && steps++ <= entries.length) {
            cur = cur.parentUuid ? byUuid.get(cur.parentUuid) : undefined
        }
        return steps > entries.length ? undefined : cur
    }

    // 收集 new→old 的链成员（到命中后前探完锚为止）
    const collected: TailEntry[] = []
    const visited = new Set<string>()
    let cur: TailEntry | undefined = leaf
    let foundAt = -1
    while (cur) {
        if (visited.has(cur.uuid)) break
        visited.add(cur.uuid)
        collected.push(cur)
        if (cur.uuid === nativeId) {
            foundAt = collected.length - 1
            break
        }
        cur = stepPastSpringboard(cur.parentUuid ? byUuid.get(cur.parentUuid) : undefined)
    }

    if (foundAt < 0) {
        // 未命中：链首走完（parentUuid 空）且已到文件头才算确定性 not-found；
        // 其余（窗口边缘 / 窗口内断链）按窗口外诚实拒绝
        const oldest = collected[collected.length - 1]
        if (oldest && oldest.parentUuid === null && headReached) {
            return { outcome: 'not-found', reason: 'chain-head' }
        }
        return { outcome: 'not-found', reason: 'window-limit' }
    }

    // 命中后前探锚：最近一条更旧的 user/assistant（同样跳过跳板行，一步到位）
    const nearest = collected[collected.length - 1]
    let anchorEntry: TailEntry | undefined
    if (nearest?.parentUuid) {
        anchorEntry = stepPastSpringboard(byUuid.get(nearest.parentUuid))
    }

    // 旧→新 + 锚入列（collect 只走到命中点，锚需补列）。链成员均为 user/assistant
    //（跳板行已在 stepPastSpringboard 跳过），raw 必在；filter 兜底类型而非运行时分支
    const chainNewToOld = collected.slice()
    if (anchorEntry && !visited.has(anchorEntry.uuid)) chainNewToOld.push(anchorEntry)
    const chain = chainNewToOld
        .slice()
        .reverse()
        .filter((e): e is TailEntry & { raw: string } => e.raw !== undefined)
        .map((e) => JSON.parse(e.raw) as SessionMessage)
    return { outcome: 'found', chain }
}

/**
 * rewind 目标分析（一次回溯同时产出锚点 + 丢弃区间，替代 findRewindAnchor +
 * analyzeDropRange 两趟头部扫描）。目标不在活链 / 深于窗口预算 / 链首目标
 * （anchor null）由调用方按 ANCHOR_REJECT 语义处理；dropRange 在 found 时恒可得
 *（区间在回溯中已走完）。
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
    const analysis = analyzeChainEntries(scan.chain, nativeId)
    if (!analysis) {
        // walkLiveChain 命中才返回 found，链必含目标——此分支仅防御
        logger.warn(`[transcriptChain] found chain missing target (target=${nativeId.slice(0, 8)})`)
        return { status: 'not-found' }
    }
    logger.debug(`[transcriptChain] fast path hit in ${Date.now() - startedAt}ms (target=${nativeId.slice(0, 8)})`)
    return { status: 'found', ...analysis }
}

/**
 * fork 激活预检的存在性判定（替代 scanTranscriptForUuid 纯存在性快路径）：
 * uuid 是否在活链上。窗口外 / 不在链 → false（与 rewind 同底座同语义）。
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
