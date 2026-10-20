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

import type { AgentEvent, ChatBlock, ErrorEvent, NormalizedMessage } from './types'

/**
 * 解析 Claude 使用限制消息
 */
function parseClaudeUsageLimit(text: string): number | null {
    const match = text.match(/^Claude AI usage limit reached\|(\d+)$/)
    if (!match) return null
    const timestamp = Number.parseInt(match[1], 10)
    if (!Number.isFinite(timestamp)) return null
    return timestamp
}

/**
 * 将消息解析为事件
 */
export function parseMessageAsEvent(msg: NormalizedMessage): AgentEvent | null {
    if (msg.isSidechain) return null
    if (msg.role !== 'agent') return null

    for (const content of msg.content) {
        if (content.type === 'text') {
            const limitReached = parseClaudeUsageLimit(content.text)
            if (limitReached !== null) {
                return { type: 'limit-reached', endsAt: limitReached }
            }
        }
    }

    return null
}

/**
 * 去重 Agent 事件块
 */
export function dedupeAgentEvents(blocks: ChatBlock[]): ChatBlock[] {
    const result: ChatBlock[] = []
    let prevEventKey: string | null = null
    let prevTitleChangedTo: string | null = null

    for (const block of blocks) {
        if (block.kind !== 'agent-event') {
            result.push(block)
            prevEventKey = null
            prevTitleChangedTo = null
            continue
        }

        const event = block.event as { type: string; [key: string]: unknown }
        if (event.type === 'title-changed' && typeof event.title === 'string') {
            const title = event.title.trim()
            const key = `title-changed:${title}`
            if (key === prevEventKey) {
                continue
            }
            result.push(block)
            prevEventKey = key
            prevTitleChangedTo = title
            continue
        }

        if (event.type === 'message' && typeof event.message === 'string') {
            const message = event.message.trim()
            const key = `message:${message}`
            if (key === prevEventKey) {
                continue
            }
            if (prevTitleChangedTo && message === prevTitleChangedTo) {
                continue
            }
            result.push(block)
            prevEventKey = key
            prevTitleChangedTo = null
            continue
        }

        let key: string
        try {
            key = `event:${JSON.stringify(event)}`
        } catch {
            key = `event:${String(event.type)}`
        }

        if (key === prevEventKey) {
            continue
        }

        result.push(block)
        prevEventKey = key
        prevTitleChangedTo = null
    }

    return result
}

/**
 * 折叠连续的错误事件：同一类别且彼此相邻时只留最新一次（时间戳、原文取最新），
 * 尝试次数取序列最大值。类别切换或中间插入普通事件 → 新起一张卡片。
 *
 * 「相邻」是硬条件：折叠的是「一次错误的重试序列」，不是跨轮次的同类错误。
 */
export function foldErrorEvents(blocks: ChatBlock[]): ChatBlock[] {
    const result: ChatBlock[] = []

    for (const block of blocks) {
        if (block.kind !== 'agent-event') {
            result.push(block)
            continue
        }
        // AgentEvent 末尾有 string 兜底成员，不能用 `type` 判别收窄，这里显式取判别成员
        const errorEvent = block.event.type === 'error' ? block.event as ErrorEvent : null
        if (!errorEvent) {
            result.push(block)
            continue
        }

        const prev = result[result.length - 1]
        const prevEvent = prev?.kind === 'agent-event' && prev.event.type === 'error'
            ? prev.event as ErrorEvent
            : null
        if (prevEvent && prevEvent.category === errorEvent.category) {
            const attempt = Math.max(prevEvent.attempt, errorEvent.attempt)
            const maxRetries = Math.max(prevEvent.maxRetries, errorEvent.maxRetries)
            result[result.length - 1] = {
                ...block,
                event: { ...errorEvent, attempt, maxRetries },
            }
        } else {
            result.push(block)
        }
    }

    return result
}

/**
 * 丢弃「重试耗尽前的同类错误卡片」。
 *
 * 自动重试失败时 CLI 先发若干条 system/api_error（每次重试一条），最后 result 再带
 * 同一错误——两处都画卡片，用户看到同一错误两遍。result 已带 errorDetail 时，把本轮
 * （最近一条用户消息之后）同类别 error 事件去掉：最终态由 result 卡片承载，重试次数
 * 已无独立展示价值；不同类别的错误（如先限流后断网）仍各自保留。
 */
export function dropRetriedErrors(blocks: ChatBlock[]): ChatBlock[] {
    const result: ChatBlock[] = []

    for (const block of blocks) {
        if (block.kind === 'agent-event' && block.event.type === 'turn-result') {
            const detail = (block.event as { errorDetail?: { category?: string } }).errorDetail
            if (detail?.category) {
                for (let i = result.length - 1; i >= 0; i--) {
                    const prev = result[i]!
                    if (prev.kind === 'user-text') break
                    if (prev.kind !== 'agent-event' || prev.event.type !== 'error') continue
                    if ((prev.event as ErrorEvent).category === detail.category) result.splice(i, 1)
                }
            }
        }
        result.push(block)
    }

    return result
}

/**
 * 丢弃「错误原文回声」文本块。
 *
 * CLI 在 API 失败时会把同一段错误文本再作为 assistant 文本发一次，落盘后与
 * turn-result 的 errorDetail 完全重复。result 已带 errorDetail 时把紧邻的
 * 同文文本块去掉，让错误只由卡片承载（原文仍在卡片的详情里）。
 */
export function dropEchoedErrorText(blocks: ChatBlock[]): ChatBlock[] {
    const result: ChatBlock[] = []

    for (const block of blocks) {
        if (block.kind === 'agent-event' && block.event.type === 'turn-result') {
            const detail = (block.event as { errorDetail?: { message?: string } }).errorDetail
            const message = detail?.message?.trim()
            if (message) {
                // 流式思考可能夹在文本与 result 之间，跳过它继续找最近一个文本块
                const prev = result[result.length - 1]
                const textIndex = prev?.kind === 'agent-reasoning' && result.length > 1
                    ? result.length - 2
                    : result.length - 1
                const candidate = result[textIndex]
                if (candidate?.kind === 'agent-text' && candidate.text.trim() === message) {
                    result.splice(textIndex, 1)
                }
            }
        }
        result.push(block)
    }

    return result
}
