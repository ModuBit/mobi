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
import type { DecryptedMessage } from '@/api/types'
import type { NormalizedMessage } from './types'
import { isSkippableAgentContent, normalizeAgentRecord } from './normalizeAgent'
import { normalizeUserRecord } from './normalizeUser'

/**
 * 标准化解密消息
 * 将原始消息转换为统一的 NormalizedMessage 格式
 */
export function normalizeDecryptedMessage(message: DecryptedMessage): NormalizedMessage | null {
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
            originalText: message.originalText
        }
    }

    if (record.role === 'user') {
        const normalized = normalizeUserRecord(message.id, message.localId, message.createdAt, record.content, record.meta)
        return normalized
            ? { ...normalized, status: message.status, originalText: message.originalText }
            : {
                id: message.id,
                localId: message.localId,
                createdAt: message.createdAt,
                role: 'user',
                isSidechain: false,
                content: { type: 'text', text: safeStringify(record.content) },
                meta: record.meta,
                status: message.status,
                originalText: message.originalText
            }
    }
    if (record.role === 'agent') {
        if (isSkippableAgentContent(record.content)) {
            return null
        }
        const normalized = normalizeAgentRecord(message.id, message.localId, message.createdAt, record.content, record.meta)
        if (normalized) {
            return { ...normalized, status: message.status, originalText: message.originalText }
        }
        // normalizeAgentRecord 对 result/success 等消息返回 null 属于正常跳过，
        // 不应走 JSON dump fallback，仅当确实是未知类型时才兜底
        const rc = record.content as Record<string, unknown>
        if (rc?.type === 'output') {
            const data = rc.data as Record<string, unknown> | null
            if (data && typeof data === 'object' && data.type === 'result') {
                return null
            }
        }
        return {
            id: message.id,
            localId: message.localId,
            createdAt: message.createdAt,
            role: 'agent',
            isSidechain: false,
            content: [{ type: 'text', text: safeStringify(record.content), uuid: message.id, parentUUID: null }],
            meta: record.meta,
            status: message.status,
            originalText: message.originalText
        }
    }

    return {
        id: message.id,
        localId: message.localId,
        createdAt: message.createdAt,
        role: 'agent',
        isSidechain: false,
        content: [{ type: 'text', text: safeStringify(record.content), uuid: message.id, parentUUID: null }],
        meta: record.meta,
        status: message.status,
        originalText: message.originalText
    }
}
