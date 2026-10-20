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
