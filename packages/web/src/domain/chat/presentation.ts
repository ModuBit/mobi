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

import type { AgentEvent, ChatBlock, MessageMeta } from './types'
import { getUserPlainText } from './userContent'

const CLEAR_COMMAND = '/clear'

/**
 * 跨会话入站来源提取（user 消息 meta.crossSession，CLI 经 UserPromptSubmit hook 观测写入）。
 * from 为非空 string 才认——信封缺 from-name 的降级落库为 null/空，此时 UI 显示通用文案。
 */
export function getCrossSessionFrom(meta: MessageMeta | undefined): string | null {
    const from = (meta as { crossSession?: { from?: unknown } } | undefined)?.crossSession?.from
    return typeof from === 'string' && from.length > 0 ? from : null
}

/** 入站 turn 来源合法值（spec 批次 D）：peer=跨会话消息 / scheduled=定时任务 / loop=/loop 唤醒 */
type TurnOrigin = 'peer' | 'scheduled' | 'loop'

const TURN_ORIGIN_VALUES: readonly TurnOrigin[] = ['peer', 'scheduled', 'loop']

/**
 * 入站 turn 来源提取（user 消息 meta.turnOrigin，CLI 落库时写入）。
 * 仅认 peer/scheduled/loop 三个合法值；缺失或非法时返回 null，UI 回退 peer 行为（from 驱动，旧消息兼容）。
 */
export function getTurnOrigin(meta: MessageMeta | undefined): TurnOrigin | null {
    const raw = (meta as { turnOrigin?: unknown } | undefined)?.turnOrigin
    return typeof raw === 'string' && (TURN_ORIGIN_VALUES as readonly string[]).includes(raw)
        ? (raw as TurnOrigin)
        : null
}

/** /compact 命令字面量，web 端判定压缩状态用 */
export const COMPACT_COMMAND = '/compact'

/**
 * compact 是否已完成（用于 isCompressing 解禁输入）。
 *
 * 两条完成信号：
 * - compact-summary block：成功路径，SDK 发 compact_boundary 后 CLI 回灌的压缩总结
 * - compact-completed event：CLI 在 compact 的 result 时（**无论成功失败**）发出的
 *   结构化事件。失败路径（如 "Not enough messages to compact."）不会产生 compact-summary，
 *   靠此事件兜底退出 compressing 状态，否则 sender 永久 disabled。
 */
export function isCompactCompletion(block: ChatBlock): boolean {
    if (block.kind === 'compact-summary') return true
    return block.kind === 'agent-event' && block.event.type === 'compact-completed'
}

/**
 * 推导某斜杠命令是否进行中：从末尾向前扫，先遇到完成标志 block → false（已完成），
 * 先遇到 user-text → 判断是否目标命令；扫到首个 user-text 为止（不固定窗口，避免命令后被大量中间 block 推出窗口）。
 * /compact、/clear 等命令期间禁用输入：compact-summary/compact-completed（compact）/ context-cleared（clear）为完成标志。
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
            return getUserPlainText(block.blocks).trim() === command
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

/**
 * rewind 命令标记：Web 确认 rewind 时本地插入的合成 user-text（不发送、不落库），
 * 仅作为 isCommandInProgress 的起点行（对齐 /clear 的「user-text 命令 → 完成事件」扫描模式）。
 * buildBubbleItems 跳过渲染该标记行。理论上与用户真实输入 /rewind 文本冲突——
 * rewinding 完成标记到达前该行会被隐藏一个 turn，可接受。
 */
export const REWIND_COMMAND = '/rewind'

/** rewind 完成标志：CLI 两段回报的终态事件（rewound-truncated 非终态——文件恢复仍在途，spec §4.5） */
export function isRewindCompletion(block: ChatBlock): boolean {
    return block.kind === 'agent-event' && block.event.type === 'rewind-completed'
}

/** rewind 是否进行中（起点：合成 REWIND_COMMAND 行；完成标志：rewind-completed 事件） */
export function isRewindInProgress(chatBlocks: ChatBlock[]): boolean {
    return isCommandInProgress(chatBlocks, REWIND_COMMAND, isRewindCompletion)
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
