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

import { unwrapRoleWrappedRecordEnvelope } from '@mobi/shared/messages'
import { safeStringify } from '@mobi/shared'
import type { DecryptedMessage } from '@/core/data/api/types'
import type { NormalizedMessage, MessageMeta } from './types'
import { isSkippableAgentContent, normalizeAgentRecord } from './normalizeAgent'
import { normalizeUserRecord } from './normalizeUser'
import { initDiag, recordSnapshot } from '@/core/lib/diag'

// 诊断埋点首次进入 normalize 链路时确保已初始化（main 侧可能因构建裁剪未调用 initDiag）
initDiag()

/**
 * 从 DecryptedMessage.content 信封提取 Anthropic message.id。
 * snapshot 与 full 共享同一 message.id（同一条 Anthropic message 的流式阶段与最终落库），
 * 是双保险第二道（reducer 按 (messageId, type) 去重）的键。与 messageCache 的 extractMessageId
 * 同源逻辑，normalize 层内联以避免 domain→cache 反向依赖。
 */
function extractAnthropicMessageId(content: unknown): string | null {
    if (!content || typeof content !== 'object') return null
    const envelope = content as Record<string, unknown>
    const inner = envelope.content
    if (!inner || typeof inner !== 'object') return null
    const data = (inner as Record<string, unknown>).data
    if (!data || typeof data !== 'object') return null
    const message = (data as Record<string, unknown>).message
    if (!message || typeof message !== 'object') return null
    const id = (message as Record<string, unknown>).id
    return typeof id === 'string' ? id : null
}

/**
 * 标准化解密消息
 * 将原始消息转换为统一的 NormalizedMessage 格式
 */
export function normalizeDecryptedMessage(message: DecryptedMessage): NormalizedMessage | null {
    // 诊断埋点：snapshot/完整消息到达 normalize 入口（记录原始形态，供渲染链路排查）
    recordSnapshot({
        kind: 'snapshot',
        snapshot: message.snapshot ?? false,
        messageId: extractAnthropicMessageId(message.content),
        localId: message.localId ?? null,
        role: (message.content as { role?: string } | null | undefined)?.role ?? 'unknown',
        content: message.content,
    })
    const snapshot = message.snapshot
    const record = unwrapRoleWrappedRecordEnvelope(message.content)
    if (!record) {
        return {
            id: message.id,
            localId: message.localId,
            createdAt: message.createdAt,
            role: 'agent',
            isSidechain: false,
            content: [{ type: 'text', text: safeStringify(message.content), uuid: message.id, parentUUID: null }],
            status: message.status,
            originalText: message.originalText,
            snapshot,
        }
    }

    if (record.role === 'user') {
        const normalized = normalizeUserRecord(message.id, message.localId, message.createdAt, record.content, record.meta as MessageMeta | undefined)
        return normalized
            ? { ...normalized, status: message.status, originalText: message.originalText, snapshot }
            : {
                id: message.id,
                localId: message.localId,
                createdAt: message.createdAt,
                role: 'user',
                isSidechain: false,
                content: { type: 'text', text: '', blocks: [{ type: 'text', text: safeStringify(record.content) }] },
                meta: record.meta as MessageMeta | undefined,
                status: message.status,
                originalText: message.originalText,
                snapshot,
            }
    }
    if (record.role === 'agent') {
        const messageId = extractAnthropicMessageId(message.content) ?? undefined
        if (isSkippableAgentContent(record.content)) {
            return null
        }
        const normalized = normalizeAgentRecord(message.id, message.localId, message.createdAt, record.content, record.meta as MessageMeta | undefined)
        if (normalized) {
            return { ...normalized, status: message.status, originalText: message.originalText, snapshot, messageId }
        }
        // normalizeAgentRecord 对 output 消息已充分识别（visible 判定 + handler 注册表）。
        // 返回 null 即「正常跳过」（result / sidechain tool_progress / 未识别 output 类型等），
        // 不走 JSON dump fallback —— 结构化消息 dump 成文本本身就是 bug
        //（如 tool_progress 心跳曾被整段渲染成 JSON 文本）。
        // 未识别类型的可观测性由 normalizeAgentRecord 的 console.warn（含 type + messageId）承担：
        // 开发期立即可见、生产不展示——此权衡优先避免 JSON 文本污染（已实证回归 bug）。
        // 仅 raw record（非 output）才兜底 dump。
        const rc = record.content as Record<string, unknown>
        if (rc?.type === 'output') {
            return null
        }
        return {
            id: message.id,
            localId: message.localId,
            createdAt: message.createdAt,
            role: 'agent',
            isSidechain: false,
            content: [{ type: 'text', text: safeStringify(record.content), uuid: message.id, parentUUID: null }],
            meta: record.meta as MessageMeta | undefined,
            status: message.status,
            originalText: message.originalText,
            snapshot,
            messageId,
        }
    }

    return {
        id: message.id,
        localId: message.localId,
        createdAt: message.createdAt,
        role: 'agent',
        isSidechain: false,
        content: [{ type: 'text', text: safeStringify(record.content), uuid: message.id, parentUUID: null }],
        meta: record.meta as MessageMeta | undefined,
        status: message.status,
        originalText: message.originalText,
        snapshot,
    }
}
