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
 * rewind 丢弃区间（afterUuid 之后到 transcript 末尾）的跨会话归因预检：
 * 返回区间内首条跨会话 user entry 的 uuid，无则 null。
 *
 * 为何需要：SDK `--resume-drops-turn` 要求丢弃区间内所有条目归因到声明的 turn，
 * 跨会话入站消息（其他会话经 UDS 直连写入的 user entry）无法归因 → 整个 resume
 * 被拒（2026-09-29 实踩：rewind 报「成功」实际两次都被拒）。在 dry-run 预检掉，
 * 免掉「点了确认必失败」的体验断点；锚点不存在（transcript 已变）返回 null 放行，
 * 执行阶段的 SDK 校验兜底。
 */
export async function findCrossSessionEntryAfter(
    sessionId: string,
    dir: string,
    afterUuid: string,
): Promise<string | null> {
    let pastAnchor = false
    for (let page = 0; page < MAX_PAGES; page++) {
        const messages = await getSessionMessages(sessionId, { dir, limit: PAGE_SIZE, offset: page * PAGE_SIZE })
        if (messages.length === 0) return null
        for (const entry of messages) {
            if (!pastAnchor) {
                if (entry.uuid === afterUuid) pastAnchor = true
                continue
            }
            if (isCrossSessionEntry(entry)) return entry.uuid
        }
        if (messages.length < PAGE_SIZE) return null
    }
    return null
}
