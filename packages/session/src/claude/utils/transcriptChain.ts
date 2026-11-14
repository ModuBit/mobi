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
//
// 已知覆盖边界：fork 锚点深于 50MB 时 chainContains 按不存在拒绝。被替代的旧
// scanTranscriptForUuid 只扫头部 2000 条——283MB 级 transcript 上同样的锚点早就
// 够不到，50MB 尾窗对它是覆盖面提升而非回退；真需要更深锚点时再谈全量扫。

import { resolveTranscriptPath } from '@mobi/node-core/claudeSdk/transcriptPath'
import { logger } from '@mobi/node-core/logger'
import { ENVELOPE_TAG } from './crossSessionEnvelope'
import { scanTailLines } from './tailReader'

/** rewind 丢弃区间分析结果（锚点之后到文件尾） */
export interface DropRangeAnalysis {
    /** 区间内「轮 prompt」user entry 数——恰为 1 时 rewind 才携带 resumeDropsTurn 守卫 */
    droppedTurns: number
    /** 区间内首条跨会话入站 user entry 的 uuid；无则 null */
    crossSessionEntry: string | null
}

/**
 * not-found 两档语义（调用方据此分流文案/重试语义）：
 * - unavailable：transcript 读不到（路径解析失败 / 读取异常）——瞬时态，重试可能恢复
 * - absent：目标不在可达范围（链首走完未命中 / 深于窗口预算 / 窗内无主线消息）——确定性拒绝
 */
export type NotFoundCause = 'absent' | 'unavailable'

/** analyzeRewindTarget 结果：found（anchor null = 目标是链首）或 not-found（带 cause） */
export type RewindTargetAnalysis =
    | { status: 'found'; anchor: string | null; dropRange: DropRangeAnalysis }
    | { status: 'not-found'; cause: NotFoundCause }

/** fork 预检存在性判定结果（cause 仅未命中时给出） */
export interface ChainLookupResult {
    found: boolean
    cause?: NotFoundCause
}

export interface ChainScanOptions {
    /** 反读窗口字节上限（内存上界），默认 50MB */
    maxBytes?: number
}

/** 首窗字节：常态回退（距尾几 KB～几百 KB）一轮命中，毫秒级 */
const INITIAL_WINDOW_BYTES = 256 * 1024
/** 窗口上限：对齐 Claude Desktop rewind 的尾部窗口量级（mainBytes 50MB） */
const DEFAULT_MAX_BYTES = 50 * 1024 * 1024

// ── 轮数计数谓词（读取层已把 user 行的 message.content 留档，此处零 parse）──

/**
 * 跨会话入站消息的判据：信封标签出现在 content **开头**（字符串形态 / text block
 * 形态都锚定起始）。真实跨会话行的 content 恒以信封 XML 开头（crossSessionEnvelope
 * 落盘形态）；用户消息只是引用/粘贴该字面量时通常在文中或代码块里，开头锚定把这类
 * 误判压掉一个量级。误判方向不对称：漏判只是少一层归因预检（SDK 侧还有校验兜底），
 * 误判则把正常轮标成跨会话、污染守卫判定。
 */
const CROSS_SESSION_MARKER_RE = new RegExp(`^<${ENVELOPE_TAG}\\b`)

/** CC 合成中断标记的已知前缀（归因到被中断的轮，不算新 turn prompt） */
const INTERRUPT_MARKER_RE = /^\[Request (?:interrupted|cancelled)/

/** content（message.content 原样）是否跨会话入站消息 */
function isCrossSessionContent(content: unknown): boolean {
    if (typeof content === 'string') return CROSS_SESSION_MARKER_RE.test(content)
    if (Array.isArray(content)) {
        return content.some((b) => {
            const text = (b as { text?: unknown } | null)?.text
            return typeof text === 'string' && CROSS_SESSION_MARKER_RE.test(text)
        })
    }
    return false
}

/**
 * content 是否为「轮 prompt」（一个新 turn 的起点）——丢弃区间轮数的计数单位。
 * 归因到所属轮、不算新 turn 的载体：tool_result 载体（数组含 tool_result block）、
 * 合成中断标记。计数偏差方向的不对称代价：低估（漏计真实轮）→ 单轮误判错误携带
 * 守卫 → CLI deterministic 拒绝、rewind 必失败；高估 → 多轮误判省略守卫 → 丢防呆
 * 但回退成功。故无 text block 的非载体形态（如仅图片的截图轮）按 prompt 计。
 */
function isTurnPromptContent(content: unknown): boolean {
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

// ── 反向窗口读 + 活链回溯（唯一数据通路，零兜底）──

/**
 * 窗口内候选行的最小化留档（只留链回溯与计数所需字段；内存上界 = 窗口字节）。
 * user 行在读取层一次 parse 留下 message.content（计数谓词零二次 parse）；
 * assistant 行不参与计数、只作锚/链节点，不留内容（通常占窗口字节大头）。
 */
interface TailEntry {
    uuid: string
    parentUuid: string | null
    type: string
    isSidechain?: boolean
    teamName?: string
    /** user 行的 message.content（原样 unknown；读取层已 parse，消费方免二次 parse） */
    userContent?: unknown
}

/** 内部未命中细分（仅进 debug 日志；对外两档 cause 由 causeOf 归并） */
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
    /** entries = 命中窗口的全部留档行（文件序），计数区间由调用方按锚位置切 */
    | { outcome: 'found'; anchor: string | null; entries: TailEntry[] }
    | { outcome: 'not-found'; reason: NotFoundReason; cause: NotFoundCause }

/** walkLiveChain 的返回（found 不带 entries——由调用方附加命中窗口的留档行） */
type ChainWalkOutcome =
    | { outcome: 'found'; anchor: string | null }
    | Extract<ChainScanOutcome, { outcome: 'not-found' }>

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
            return { outcome: 'not-found', reason: 'read-error', cause: 'unavailable' }
        }
        if (loaded.unavailable) {
            // 文件不存在/打不开（与空文件区分：后者 headReached=true 的确定性空）
            logger.debug('[transcriptChain] transcript unavailable')
            return { outcome: 'not-found', reason: 'read-error', cause: 'unavailable' }
        }
        const outcome = walkLiveChain(loaded.entries, loaded.headReached, nativeId)
        if (outcome.outcome === 'found') return { ...outcome, entries: loaded.entries }
        // 已读文件头（not-found 是确定性的）或窗口已到预算上限（诚实拒绝）→ 终止
        if (loaded.headReached || windowBytes >= maxBytes) return outcome
        windowBytes = Math.min(windowBytes * 2, maxBytes)
    }
}

/**
 * 读取尾部窗口：只保留链回溯相关行的最小留档（半行切分/精确行边界/到头判定/
 * 读不到分流由 tailReader 承担）。
 */
async function readTailWindow(
    filePath: string,
    windowBytes: number,
): Promise<{ entries: TailEntry[]; headReached: boolean; unavailable: boolean }> {
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
            userContent: type === 'user'
                ? (parsed.message as { content?: unknown } | null | undefined)?.content
                : undefined,
        })
    }
    return { entries, headReached: scan.headReached, unavailable: scan.unavailable }
}

/**
 * 活链回溯：leaf = 窗口内文件序最后一条主线 user/assistant entry（对齐 SDK 视图
 * 的 leaf 判定：排除 sidechain/team；记账行已在读取层弃掉）。沿 parentUuid 向旧走，
 * 直至命中目标（再前探一条 user/assistant 作锚）、链首（未命中，确定性）、或窗口
 * 边缘（由调用方扩窗/诚实拒绝）。attachment/system（含 compact_boundary）等非消息
 * 行一律按跳板跳过续走——raw 链经它们连续，跨 compact 的回退照常可用。
 */
function walkLiveChain(entries: TailEntry[], headReached: boolean, nativeId: string): ChainWalkOutcome {
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
    if (!leaf) return { outcome: 'not-found', reason: 'no-live-leaf', cause: 'absent' }

    /** 跳板推进：cur 若非 user/assistant，沿 parentUuid 续走直到消息行或链尽。
     *  步数上界 = 窗口行数：正常路径每行至多经过一次，超出即数据自环，按链尽处理 */
    const stepPastSpringboard = (cur: TailEntry | undefined): TailEntry | undefined => {
        for (let steps = 0; cur && steps <= entries.length; steps++) {
            if (cur.type === 'user' || cur.type === 'assistant') return cur
            cur = cur.parentUuid ? byUuid.get(cur.parentUuid) : undefined
        }
        return undefined
    }

    const visited = new Set<string>()
    let cur: TailEntry | undefined = leaf
    let target: TailEntry | null = null
    while (cur) {
        if (visited.has(cur.uuid)) break
        visited.add(cur.uuid)
        if (cur.uuid === nativeId) {
            target = cur
            break
        }
        const next = stepPastSpringboard(cur.parentUuid ? byUuid.get(cur.parentUuid) : undefined)
        if (!next && cur.parentUuid !== null) {
            // parentUuid 非空却走不通（前驱行在窗外 / 链断 / compact_boundary 处物理
            // 断链）→ 按窗口边缘处理，交调用方扩窗；扩满仍不通才诚实拒绝
            return { outcome: 'not-found', reason: 'window-limit', cause: 'absent' }
        }
        cur = next
    }

    if (!target) {
        // 链首走完（parentUuid 空）且已到文件头 → 确定性不在链上；链首在窗外等场景
        // 按 window-limit 诚实拒绝
        if (headReached) return { outcome: 'not-found', reason: 'chain-head', cause: 'absent' }
        return { outcome: 'not-found', reason: 'window-limit', cause: 'absent' }
    }

    // 命中后前探锚：最近一条更旧的 user/assistant（同样跳过跳板行，一步到位）。
    // 前驱走不通（窗外/断链）≠ 目标是链首——anchor null 会把「窗口边缘」伪装成
    // 「/clear 引导」，必须按 window-limit 交调用方扩窗；真链首（parentUuid 空）
    // 才返回 anchor null（调用方按 /clear 引导拒绝，2026-09-21 事故不变量：锚取
    // 目标前最近 user/assistant，使截断区间第一条恰为声明的 turn prompt）
    let anchor: string | null = null
    if (target.parentUuid) {
        const anchorEntry = stepPastSpringboard(byUuid.get(target.parentUuid))
        if (!anchorEntry) return { outcome: 'not-found', reason: 'window-limit', cause: 'absent' }
        anchor = anchorEntry.uuid
    }
    return { outcome: 'found', anchor }
}

/**
 * rewind 目标分析（一次回溯同时产出锚点 + 丢弃区间，替代 findRewindAnchor +
 * analyzeDropRange 两趟头部扫描）。目标不在活链 / 深于窗口预算 / 链首目标
 * （anchor null）由调用方按 ANCHOR_REJECT 语义处理；transcript 读不到按
 * cause: 'unavailable' 分流（与「锚点不在」的确定性拒绝分开报）。
 */
export async function analyzeRewindTarget(
    sessionId: string,
    dir: string,
    nativeId: string,
    opts?: ChainScanOptions,
): Promise<RewindTargetAnalysis> {
    const startedAt = Date.now()
    const maxBytes = opts?.maxBytes ?? DEFAULT_MAX_BYTES
    const resolved = resolveTranscriptPath(sessionId, dir)
    if (!resolved.ok) {
        logger.debug(`[transcriptChain] not-found (path-unresolved) in ${Date.now() - startedAt}ms (target=${nativeId.slice(0, 8)})`)
        return { status: 'not-found', cause: 'unavailable' }
    }

    const scan = await reverseChainScan(resolved.path, nativeId, maxBytes)
    if (scan.outcome !== 'found') {
        logger.debug(`[transcriptChain] not-found (${scan.reason}) in ${Date.now() - startedAt}ms (target=${nativeId.slice(0, 8)})`)
        return { status: 'not-found', cause: scan.cause }
    }
    const { anchor, entries } = scan

    // 丢弃区间计数（文件序口径）：CLI resumeDropsTurn 归因读的是「锚点在文件中的
    // 位置之后到文件尾」的物理区间，截断同样按位置切——死分支 user 行一并丢弃，
    // 只数活链成员会低估轮数（单轮误判 → 错误携带守卫 → CLI deterministic 必拒）。
    // 主线口径对齐 leaf 判定：sidechain/team 行不入区间计数
    const anchorIdx = anchor === null ? -1 : entries.findIndex((e) => e.uuid === anchor)
    let droppedTurns = 0
    let crossSessionEntry: string | null = null
    for (let i = anchorIdx + 1; i < entries.length; i++) {
        const e = entries[i]!
        if (e.type !== 'user' || e.isSidechain || e.teamName) continue
        if (isCrossSessionContent(e.userContent)) {
            crossSessionEntry ??= e.uuid
            continue
        }
        if (isTurnPromptContent(e.userContent)) droppedTurns++
    }

    logger.debug(`[transcriptChain] fast path hit in ${Date.now() - startedAt}ms (target=${nativeId.slice(0, 8)})`)
    return { status: 'found', anchor, dropRange: { droppedTurns, crossSessionEntry } }
}

/**
 * fork 激活预检的存在性判定（替代 scanTranscriptForUuid 纯存在性快路径）：
 * uuid 是否出现在尾部窗口内。**纯存在性、不走活链**——fork 锚点可能落在死分支或
 * compact 前旧段（活链回溯不可达但文件里仍在），而 CLI 的 resumeSessionAt 按
 * 文件存在性定位。窗口外 / 不在 → 未命中（absent）；transcript 读不到 →
 * unavailable（调用方可分流「parent 文件丢失」语义）。几何扩窗同 rewind；深于
 * 50MB 预算的锚点按不存在拒绝（见文件头「已知覆盖边界」）。
 */
export async function chainContains(
    sessionId: string,
    dir: string,
    uuid: string,
    opts?: ChainScanOptions,
): Promise<ChainLookupResult> {
    const resolved = resolveTranscriptPath(sessionId, dir)
    if (!resolved.ok) return { found: false, cause: 'unavailable' }

    const maxBytes = opts?.maxBytes ?? DEFAULT_MAX_BYTES
    let windowBytes = Math.min(INITIAL_WINDOW_BYTES, maxBytes)
    for (;;) {
        let loaded: Awaited<ReturnType<typeof readTailWindow>>
        try {
            loaded = await readTailWindow(resolved.path, windowBytes)
        } catch (e) {
            logger.debug('[transcriptChain] tail scan failed', e)
            return { found: false, cause: 'unavailable' }
        }
        if (loaded.unavailable) return { found: false, cause: 'unavailable' }
        if (loaded.entries.some((e) => e.uuid === uuid)) return { found: true }
        // 已读文件头（确定性没有）或预算耗尽 → 未命中
        if (loaded.headReached || windowBytes >= maxBytes) return { found: false, cause: 'absent' }
        windowBytes = Math.min(windowBytes * 2, maxBytes)
    }
}
