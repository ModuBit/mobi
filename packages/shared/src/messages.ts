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

import { isObject } from './utils'

type RoleWrappedRecord = {
    role: string
    content: unknown
    meta?: unknown
}

// Claude 系统消息中可见的子类型
const VISIBLE_CLAUDE_SYSTEM_SUBTYPES = new Set([
    'api_error',
    'api_retry',
    'turn_duration',
    'microcompact_boundary',
    'compact_boundary',
    'task_progress',
    'task_notification',
    'task_started',
    'task_updated',
])

export function isRoleWrappedRecord(value: unknown): value is RoleWrappedRecord {
    if (!isObject(value)) return false
    return typeof value.role === 'string' && 'content' in value
}

export function unwrapRoleWrappedRecordEnvelope(value: unknown): RoleWrappedRecord | null {
    if (isRoleWrappedRecord(value)) return value
    if (!isObject(value)) return null

    const direct = value.message
    if (isRoleWrappedRecord(direct)) return direct

    const data = value.data
    if (isObject(data) && isRoleWrappedRecord(data.message)) return data.message as RoleWrappedRecord

    const payload = value.payload
    if (isObject(payload) && isRoleWrappedRecord(payload.message)) return payload.message as RoleWrappedRecord

    return null
}

/**
 * 判断 Claude 系统消息子类型是否在聊天中可见
 */
export function isClaudeChatVisibleSystemSubtype(subtype: unknown): subtype is string {
    return typeof subtype === 'string' && VISIBLE_CLAUDE_SYSTEM_SUBTYPES.has(subtype)
}

/**
 * 判断消息是否在 Claude 聊天中可见
 *
 * 黑名单仅覆盖 system 子类型：非 system 的顶层 type 一律视为可见（由 normalize handler
 * 决定如何渲染，未识别类型在 normalizeAgentRecord console.warn 后跳过，不走 JSON dump）。
 * 历史上曾为 tool_progress/tool_use_summary 设过顶层黑名单，接入 handler 后已移除——
 * 回滚入口是 git history，无需常驻空集合。
 */
export function isClaudeChatVisibleMessage(message: { type: unknown; subtype?: unknown }): boolean {
    if (message.type !== 'system') {
        return true
    }

    return isClaudeChatVisibleSystemSubtype(message.subtype)
}

export type { RoleWrappedRecord }

/**
 * 消息来源标识（meta.sentFrom）。
 *
 * 开放联合：已知来源（'cli' / 'webapp'）有补全，未来端可按字符串扩展，
 * `(string & {})` 让任意新值仍可赋值而不必先改这里。
 */
export type SentFrom = 'cli' | 'webapp' | (string & {})

/**
 * 排队生命周期状态（messages.queue_state 列）。
 * - `null`：非排队轨道消息（agent/CLI/system 输出等），从不进入排队悬浮条。
 * - `'pending'`：webapp 用户提交、等待 agent 消费（悬浮展示）。
 * - `'consumed'`：已离开排队轨道——通常是 agent 消费，也可能是被 /compact、/clear 等命令
 *   清空队列时丢弃（agent 不会再处理，但作为用户已发送的消息留在历史，故仍走 submittedAt 落库、
 *   positionAt 跳变，而非物理删除）。Web 据此移出悬浮条、翻为正式气泡。
 */
export type QueueState = 'pending' | 'consumed' | null

/** 从消息 content 信封读取 sentFrom 来源标识 */
export function getSentFrom(content: unknown): SentFrom | null {
    if (!isObject(content)) return null
    const meta = (content as { meta?: { sentFrom?: unknown } }).meta
    const sf = meta?.sentFrom
    return typeof sf === 'string' ? sf as SentFrom : null
}

/** 是否为 CLI 来源（Claude Code 输出流回显，永不排队） */
export function isCliOrigin(content: unknown): boolean {
    return getSentFrom(content) === 'cli'
}

/**
 * 是否为「可进入排队轨道的用户提交消息」。
 *
 * 语义（denylist）：**只有 CLI 来源一定不排队**——CLI 消息是 Claude Code 输出流的
 * 回显（local-command-stdout、compact continuation summary 等），已在对话里，不是
 * 待消费的用户输入。其余所有来源（webapp 及未来端）默认排队。
 *
 * 这是「排队」的**唯一写入决策点**：Hub `addMessage` 据此决定 queue_state。
 * Web 端只读 queue_state，不再反推来源。
 */
export function isQueueableUserSubmission(content: unknown, localId: string | null | undefined): boolean {
    if (!localId) return false
    if (!isRoleWrappedRecord(content)) return false
    if (content.role !== 'user') return false
    return !isCliOrigin(content)
}
