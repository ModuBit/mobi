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

import { getSessionMessages, type SessionMessage } from '@anthropic-ai/claude-agent-sdk'
import { logger } from '@mobi/node-core/logger'

/** 正向分页每页条数 */
const PAGE_SIZE = 50
/** 最大回扫页数（防病态长链死循环；50×40=2000 条 entry 覆盖常规会话） */
const MAX_PAGES = 40

/**
 * transcript 分页扫描的共享骨架（rewind 锚点换算与 fork 激活预检两个消费方，
 * 同一「offset 从头部正向跳过、旧→新返回」的分页语义——PoC poc8 实测结论）：
 * 逐页读入直到 uuid 精确命中（user 类型 entry 含 tool_result 载体，不能按计数匹配）、
 * 空页 / 末页不满（扫完）、或超过 MAX_PAGES（防病态长链）为止。
 *
 * @param onHit 命中时回调一次（scanned 为旧→新全量已扫前缀，hitIndex 为命中位置）——
 *              需要命中上下文的消费方用（如 rewind 找锚点前驱 assistant）；
 *              不传即纯存在性判定，逐页判定不累积前缀（省去回看用不到的累积成本）
 * @returns 'found' | 'not-found'（读取异常不在此吞：由消费方按各自失败语义处理）
 */
export async function scanTranscriptForUuid(
    sessionId: string,
    dir: string,
    uuid: string,
    onHit?: (scanned: SessionMessage[], hitIndex: number) => void,
): Promise<'found' | 'not-found'> {
    // 纯存在性判定（无 onHit）不累积前缀：逐页判定即弃，不为回看语义白付累积与全前缀 findIndex
    const scanned: SessionMessage[] | null = onHit ? [] : null

    for (let page = 0; page < MAX_PAGES; page++) {
        const messages = await getSessionMessages(sessionId, { dir, limit: PAGE_SIZE, offset: page * PAGE_SIZE })
        if (messages.length === 0) {
            logger.debug(`[transcriptScan] exhausted transcript without hitting ${uuid} (page=${page})`)
            return 'not-found'
        }

        if (scanned) {
            scanned.push(...messages)
            const idx = scanned.findIndex(m => m.uuid === uuid)
            if (idx >= 0) {
                onHit?.(scanned, idx)
                return 'found'
            }
        } else if (messages.some(m => m.uuid === uuid)) {
            return 'found'
        }

        if (messages.length < PAGE_SIZE) {
            logger.debug(`[transcriptScan] reached transcript end without hitting ${uuid}`)
            return 'not-found'
        }
    }

    // 超出回扫上限仍未命中：按未命中处理（防病态长链）
    logger.warn(`[transcriptScan] exceeded MAX_PAGES (${MAX_PAGES}) without hitting ${uuid}`)
    return 'not-found'
}

/** 跨会话入站消息在 transcript 里的标记前缀（CC 原生 SendMessage 写入的 user entry 载体） */
const CROSS_SESSION_MARKER = '<cross-session-message'

/** CC 合成中断标记的已知前缀（归因到被中断的轮，不算新 turn prompt；真实形态实录：
 *  text blocks 数组 "[Request interrupted by user]"、字符串 "[Request interrupted by
 *  user for tool use]" 等，正则覆盖 interrupted/cancelled 变体） */
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

/** user entry 是否为「轮 prompt」（一个新 turn 的起点）——丢弃区间轮数的计数单位。
 *  归因到所属轮、不算新 turn 的载体：tool_result 载体（数组含 tool_result block）、
 *  合成中断标记。跨会话入站消息的归口在调用方（analyzeDropRange 先行 continue），
 *  本谓词不再复检。
 *  计数偏差方向的不对称代价：低估（漏计真实轮）→ 单轮误判错误携带守卫 → CLI
 *  deterministic 拒绝、rewind 必失败；高估 → 多轮误判省略守卫 → 丢防呆但回退成功。
 *  故无 text block 的非载体形态（如仅图片的截图轮）按 prompt 计。 */
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

/** rewind 丢弃区间分析结果（锚点之后到 transcript 末尾） */
export interface DropRangeAnalysis {
    /** 区间内「轮 prompt」user entry 数——恰为 1 时 rewind 才携带 resumeDropsTurn 守卫
     *  （CLI 只接受丢弃区间恰好等于声明的一轮，多轮必拒；跨多轮省略守卫走未校验截断） */
    droppedTurns: number
    /** 区间内首条跨会话入站 user entry 的 uuid；无则 null（单轮守卫路径据此预检拒绝） */
    crossSessionEntry: string | null
}

/**
 * rewind 丢弃区间分析（anchorUuid 之后到 transcript 末尾）：一次遍历同时产出
 * 区间轮数与跨会话归因，供 rewind dry-run / 执行侧决定是否携带 resumeDropsTurn 守卫。
 *
 * 为何需要轮数：SDK `--resume-drops-turn` 要求丢弃区间内所有条目归因到声明的一轮，
 * 区间跨多轮（中断后队列照跑 / 回退更早消息）→ CLI deterministic 拒绝；省略守卫
 * 则退化为未校验截断（SDK 官方语义：Omit to keep the unvalidated truncation behavior），
 * 同 id 同文件、多轮回退照常成功。
 *
 * 锚点不存在（transcript 已变）返回 null：调用方保守省略守卫，SDK 兜底。
 */
export async function analyzeDropRange(
    sessionId: string,
    dir: string,
    anchorUuid: string,
): Promise<DropRangeAnalysis | null> {
    let pastAnchor = false
    let droppedTurns = 0
    let crossSessionEntry: string | null = null
    // 是否完整扫到 transcript 末尾（空页 / 末页不满）；页数耗尽时计数被截断
    let complete = false
    for (let page = 0; page < MAX_PAGES; page++) {
        const messages = await getSessionMessages(sessionId, { dir, limit: PAGE_SIZE, offset: page * PAGE_SIZE })
        if (messages.length === 0) {
            complete = true
            break
        }
        for (const entry of messages) {
            if (!pastAnchor) {
                if (entry.uuid === anchorUuid) pastAnchor = true
                continue
            }
            if (isCrossSessionEntry(entry)) {
                crossSessionEntry ??= entry.uuid
                continue
            }
            if (isTurnPromptEntry(entry)) droppedTurns++
        }
        if (messages.length < PAGE_SIZE) {
            complete = true
            break
        }
    }
    // 页数耗尽仍未到末尾：区间超出扫描窗口，轮数是截断值——不可作守卫判定依据，
    // 返回 null 让调用方走「分析不可得」分支（对齐 scanTranscriptForUuid 的 exceed 告警）
    if (!complete) {
        logger.warn(`[transcriptScan] analyzeDropRange exceeded MAX_PAGES (${MAX_PAGES}) after anchor ${anchorUuid}`)
        return null
    }
    return pastAnchor ? { droppedTurns, crossSessionEntry } : null
}
