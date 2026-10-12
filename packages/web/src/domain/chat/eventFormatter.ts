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

/**
 * Agent 事件格式化（纯数据，src 分层治理票 01 去 React 化）。
 *
 * domain 只产出结构化描述（FormattedEvent）：i18n 以 key + params 形态透传，
 * t() 执行、mono 字体、时间戳后缀等呈现细节由调用侧 EventText 组件落——
 * domain 零 React / 零 i18n runtime（depcruise web-domain-no-react 强制）。
 */

import { formatMessageTime } from '@/core/utils/timeFormat'
import type { AgentEvent } from './types'

/** i18n 待执行文本：key + 插值参数，t() 由调用侧（EventText）执行 */
export interface I18nText {
    key: string
    params?: Record<string, unknown>
}

/** 事件渲染行：segments 内联拼接（I18nText 待 t()）；mono = var(--font-mono) 行；spaced = 行顶留 2px；timeSuffix = 行尾时间戳（marginLeft 8） */
export interface EventLine {
    segments: Array<string | I18nText>
    mono?: boolean
    spaced?: boolean
    timeSuffix?: string
}

/** turn-result 事件的载荷类型（展开详情 UI 由 TurnResultMeta 消费） */
export type TurnResultEvent = Extract<AgentEvent, { type: 'turn-result' }>

/** formatEvent 产出：多行文本（含 i18n 待执行）或 turn-result 委托；null = 不渲染 */
export type FormattedEvent =
    | { kind: 'lines'; lines: EventLine[] }
    | { kind: 'turn-result'; event: TurnResultEvent; createdAt?: number }
    | null

/** 毫秒 → 可读时长（turn 概要与详情共用，避免两处公式偏移） */
export function formatDurationMs(ms: number): string {
    if (ms >= 60000) {
        const min = Math.floor(ms / 60000)
        const sec = Math.floor((ms % 60000) / 1000)
        return `${min}m ${sec}s`
    }
    if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`
    return `${ms}ms`
}

/** token 数 → 「N tokens / Nk tokens」概要串 */
export function formatTokensCount(tokens: number): string {
    return tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k tokens` : `${tokens} tokens`
}

/** 从嵌套 error 对象中提取错误详情 */
export function extractApiErrorDetail(error: unknown): string | null {
    if (!error || typeof error !== 'object') return null
    const err = error as Record<string, unknown>
    if (err.error && typeof err.error === 'object') {
        const inner = err.error as Record<string, unknown>
        if (inner.error && typeof inner.error === 'object') {
            const deepest = inner.error as Record<string, unknown>
            const code = typeof deepest.code === 'string' ? deepest.code : ''
            const message = typeof deepest.message === 'string' ? deepest.message : ''
            if (code || message) return `${code ? `[${code}] ` : ''}${message}`
        }
    }
    return null
}

/**
 * 格式化 Agent 事件为结构化描述（原返回 ReactNode，分层治理票 01 起纯数据化）。
 * 呈现由 components/chat/EventText 执行；turn-result 委托 TurnResultMeta（actions 挂概要行尾）。
 */
export function formatEvent(event: { type: string; [key: string]: unknown }, createdAt?: number): FormattedEvent {
    switch (event.type) {
        case 'api-retry': {
            const attempt = Number(event.attempt) || 0
            const maxRetries = Number(event.maxRetries) || 0
            const delaySec = Math.ceil((Number(event.retryDelayMs) || 0) / 1000)
            const errorStatus = Number(event.errorStatus) || 0
            const errorLabel: I18nText = { key: errorStatus === 429 ? 'chat.apiRateLimit' : 'chat.apiError' }
            return {
                kind: 'lines',
                lines: [
                    {
                        segments: [
                            errorLabel,
                            ...(attempt > 0 ? [' (', { key: 'chat.retry' }, ` ${attempt}/${maxRetries})`] : []),
                        ],
                    },
                    ...(delaySec > 0 ? [{ segments: [{ key: 'chat.retryDelay', params: { seconds: delaySec } } as I18nText] as Array<string | I18nText>, spaced: true }] : []),
                ],
            }
        }
        case 'api-error': {
            const detail = extractApiErrorDetail(event.error)
            const retryAttempt = Number(event.retryAttempt) || 0
            const maxRetries = Number(event.maxRetries) || 0
            return {
                kind: 'lines',
                lines: [
                    {
                        segments: [
                            { key: 'chat.apiError' },
                            ...(retryAttempt > 0 ? [' (', { key: 'chat.retry' }, ` ${retryAttempt}/${maxRetries})`] : []),
                        ],
                    },
                    ...(detail ? [{ segments: [detail] as Array<string | I18nText>, spaced: true }] : []),
                ],
            }
        }
        case 'turn-duration': {
            const ms = Number(event.durationMs) || 0
            return { kind: 'lines', lines: [{ segments: [{ key: 'chat.durationValue', params: { value: formatDurationMs(ms) } }] }] }
        }
        case 'switch': {
            const mode = String(event.mode || '')
            return { kind: 'lines', lines: [{ segments: [{ key: 'chat.switchMode', params: { mode } }] }] }
        }
        case 'aborted': {
            const durationMs = Number(event.durationMs) || 0
            const tokens = Number(event.tokens) || 0
            const hasMetrics = durationMs > 0 || tokens > 0

            // 文案优先级（spec §4.3，自上而下首条命中）：
            // stillQueued>0（对账异常信号）> 队列已清空 > 队列与后台任务已停止 > 现状
            const stillQueued = Number(event.stillQueuedCount) || 0
            const stopKind = typeof event.stopKind === 'string' ? event.stopKind : undefined
            const baseLabel: I18nText = stillQueued > 0
                ? { key: 'chat.abortedStillQueued', params: { count: stillQueued } }
                : stopKind === 'turn-queue'
                    ? { key: 'chat.abortedQueueCleared' }
                    : stopKind === 'turn-queue-tasks'
                        ? { key: 'chat.abortedAllStopped' }
                        : { key: 'chat.aborted' }

            const segments: Array<string | I18nText> = [baseLabel]
            if (hasMetrics) {
                const durationText = formatDurationMs(durationMs)
                const tokensText = tokens >= 1000
                    ? `${(tokens / 1000).toFixed(1)}k tokens`
                    : `${tokens} tokens`
                segments.push(` · ${durationText} · ${tokensText}`)
            }

            return {
                kind: 'lines',
                lines: [{
                    segments,
                    mono: true,
                    ...(createdAt ? { timeSuffix: formatMessageTime(createdAt) } : {}),
                }],
            }
        }
        case 'title-changed': {
            return null
        }
        case 'plan-mode-entered': {
            return { kind: 'lines', lines: [{ segments: [{ key: 'chat.planMode.entered' }] }] }
        }
        case 'plan-mode-enter-failed': {
            return { kind: 'lines', lines: [{ segments: [{ key: 'chat.planMode.enterFailed' }] }] }
        }
        case 'turn-result': {
            return { kind: 'turn-result', event: event as TurnResultEvent, ...(createdAt ? { createdAt } : {}) }
        }
        // goal-progress：每 turn 的目标达成状态标注（stream 三大展示面之一）
        // met=true 达成(success 绿，由 reducer display.color=success + AgentEventBlock 配合)，
        // met=false active(中性灰)。后跟 condition + 可选统计
        // compact_boundary：上下文压缩完成（手动 /compact 与 auto-compact 共用此事件）。
        // auto-compact 唯一的用户可见信号就在这——手动路径另有 user 消息 + compact-summary 撑着，
        // 此 case 缺失时自动压缩在聊天里完全隐形（与 goal-progress 当年同坑：落 default:null）
        case 'compact': {
            const pre = Number(event.preTokens) || 0
            const post = Number(event.postTokens) || 0
            const durationMs = Number(event.durationMs) || 0
            // post 缺失（失败压缩 post_tokens 可选，CLI 侧兜底 0）时不得渲染「pre → 0」
            // 假统计——对用户声称压缩成功且压到 0 tokens；仅 pre/post 均有效才显示变化
            const stats: string[] = []
            if (pre > 0 && post > 0) stats.push(`${formatTokensCount(pre)} → ${formatTokensCount(post)}`)
            else if (pre > 0) stats.push(formatTokensCount(pre))
            else if (post > 0) stats.push(`${formatTokensCount(post)} tokens`)
            if (durationMs > 0) stats.push(formatDurationMs(durationMs))
            return {
                kind: 'lines',
                lines: [{
                    segments: ['📦 ', { key: 'chat.contextCompacted' }, ...(stats.length > 0 ? [` · ${stats.join(' · ')}`] : [])],
                    mono: true,
                }],
            }
        }
        // microcompact_boundary：工具结果等旧内容的微压缩（上下文结构不变），只报节省量
        case 'microcompact': {
            const saved = Number(event.tokensSaved) || 0
            return {
                kind: 'lines',
                lines: [{
                    // 历史行为保留：formatTokensCount 产物已含「 tokens」后缀，此处再拼一次
                    // （上游如此渲染，改文案属行为变更——已记 pending，分层治理票外裁决）
                    segments: ['📦 ', { key: 'chat.contextMicrocompacted' }, ...(saved > 0 ? [` · ${formatTokensCount(saved)} tokens`] : [])],
                    mono: true,
                }],
            }
        }
        case 'goal-progress': {
            const met = event.met === true
            const condition = typeof event.condition === 'string' ? event.condition : ''
            const iterations = typeof event.iterations === 'number' ? event.iterations : undefined
            const durationMs = typeof event.durationMs === 'number' ? event.durationMs : undefined
            const tokens = typeof event.tokens === 'number' ? event.tokens : undefined

            const stats: string[] = []
            if (iterations !== undefined) stats.push(`${iterations} turns`)
            if (durationMs !== undefined) stats.push(formatDurationMs(durationMs))
            if (tokens !== undefined && tokens > 0) stats.push(formatTokensCount(tokens))

            return {
                kind: 'lines',
                lines: [{
                    segments: [
                        met ? '✓ goal 达成' : '◎ goal active',
                        ...(condition ? [` · ${condition}`] : []),
                        ...(stats.length > 0 ? [` · ${stats.join(' · ')}`] : []),
                    ],
                    mono: true,
                }],
            }
        }
        default:
            return null
    }
}
