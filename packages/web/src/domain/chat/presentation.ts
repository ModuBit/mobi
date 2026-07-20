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

import type { AgentEvent, ChatBlock } from './types'

const CLEAR_COMMAND = '/clear'

/**
 * 推导某斜杠命令是否进行中：从末尾向前扫，先遇到完成标志 block → false（已完成），
 * 先遇到 user-text → 判断是否目标命令；扫到首个 user-text 为止（不固定窗口，避免命令后被大量中间 block 推出窗口）。
 * /compact、/clear 等命令期间禁用输入：compact-summary（compact）/ context-cleared（clear）为完成标志。
 */
export function isCommandInProgress(
    chatBlocks: ChatBlock[],
    command: string,
    isCompletion: (block: ChatBlock) => boolean
): boolean {
    for (let i = chatBlocks.length - 1; i >= 0; i--) {
        const block = chatBlocks[i]
        if (isCompletion(block)) return false
        if (block.kind === 'user-text') {
            return block.text.trim() === command
        }
    }
    return false
}

/** /clear 是否进行中（完成标志：context-cleared 事件） */
export function isClearInProgress(chatBlocks: ChatBlock[]): boolean {
    return isCommandInProgress(
        chatBlocks,
        CLEAR_COMMAND,
        (block) => block.kind === 'agent-event' && block.event.type === 'context-cleared'
    )
}

export function formatUnixTimestamp(value: number): string {
    const ms = value < 1_000_000_000_000 ? value * 1000 : value
    const date = new Date(ms)
    if (Number.isNaN(date.getTime())) return String(value)
    return date.toLocaleString()
}

function formatDuration(ms: number): string {
    const seconds = ms / 1000
    if (seconds < 60) return `${seconds.toFixed(1)}s`
    const mins = Math.floor(seconds / 60)
    const secs = Math.round(seconds % 60)
    return `${mins}m ${secs}s`
}

export type EventPresentation = {
    icon: string | null
    text: string
}

export function getEventPresentation(event: AgentEvent): EventPresentation {
    if (event.type === 'api-error') {
        const { retryAttempt, maxRetries } = event as { retryAttempt: number; maxRetries: number }
        if (maxRetries > 0 && retryAttempt >= maxRetries) {
            return { icon: '⚠️', text: 'API error: Max retries reached' }
        }
        if (maxRetries > 0) {
            return { icon: '⏳', text: `API error: Retrying (${retryAttempt}/${maxRetries})` }
        }
        if (retryAttempt > 0) {
            return { icon: '⏳', text: 'API error: Retrying...' }
        }
        return { icon: '⚠️', text: 'API error' }
    }
    if (event.type === 'switch') {
        const mode = event.mode === 'local' ? 'local' : 'remote'
        return { icon: '🔄', text: `Switched to ${mode}` }
    }
    if (event.type === 'title-changed') {
        const title = typeof event.title === 'string' ? event.title : ''
        return { icon: null, text: title ? `Title changed to "${title}"` : 'Title changed' }
    }
    if (event.type === 'permission-mode-changed') {
        const modeValue = (event as Record<string, unknown>).mode
        const mode = typeof modeValue === 'string' ? modeValue : 'default'
        return { icon: '🔐', text: `Permission mode: ${mode}` }
    }
    if (event.type === 'limit-reached') {
        const endsAt = typeof event.endsAt === 'number' ? event.endsAt : null
        return { icon: '⏳', text: endsAt ? `Usage limit reached until ${formatUnixTimestamp(endsAt)}` : 'Usage limit reached' }
    }
    if (event.type === 'message') {
        return { icon: null, text: typeof event.message === 'string' ? event.message : 'Message' }
    }
    if (event.type === 'turn-duration') {
        const ms = typeof event.durationMs === 'number' ? event.durationMs : 0
        return { icon: '⏱️', text: `Turn: ${formatDuration(ms)}` }
    }
    if (event.type === 'microcompact') {
        const saved = typeof event.tokensSaved === 'number' ? event.tokensSaved : 0
        const formatted = saved >= 1000 ? `${Math.round(saved / 1000)}K` : String(saved)
        return { icon: '📦', text: `Context compacted (saved ${formatted} tokens)` }
    }
    if (event.type === 'compact') {
        return { icon: '📦', text: 'Conversation compacted' }
    }
    if (event.type === 'context-cleared') {
        return { icon: null, text: 'Context was reset' }
    }
    try {
        return { icon: null, text: JSON.stringify(event) }
    } catch {
        return { icon: null, text: String(event.type) }
    }
}

export function renderEventLabel(event: AgentEvent): string {
    return getEventPresentation(event).text
}
