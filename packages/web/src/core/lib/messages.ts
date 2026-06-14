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

import type { InfiniteData } from '@tanstack/react-query'
import type { DecryptedMessage, MessagesResponse } from '@/core/data/api/types'
import { uuid } from './uuid'

/**
 * 生成客户端唯一 ID
 */
export function makeClientSideId(prefix: string): string {
    return `${prefix}-${uuid()}`
}

/**
 * 判断是否为用户消息
 */
export function isUserMessage(msg: DecryptedMessage): boolean {
    const content = msg.content
    if (content && typeof content === 'object' && 'role' in content) {
        return (content as { role: string }).role === 'user'
    }
    return false
}

/**
 * 判断是否为乐观更新消息
 */
function isOptimisticMessage(msg: DecryptedMessage): boolean {
    return Boolean(msg.localId && msg.id === msg.localId)
}

/**
 * 消息比较函数，用于排序
 */
function compareMessages(a: DecryptedMessage, b: DecryptedMessage): number {
    const aSeq = typeof a.seq === 'number' ? a.seq : null
    const bSeq = typeof b.seq === 'number' ? b.seq : null

    if (aSeq !== null && bSeq !== null && aSeq !== bSeq) {
        return aSeq - bSeq
    }

    if (a.createdAt !== b.createdAt) {
        return a.createdAt - b.createdAt
    }
    return a.id.localeCompare(b.id)
}

/**
 * 合并消息列表
 * 处理乐观更新消息的去重和合并
 */
export function mergeMessages(existing: DecryptedMessage[], incoming: DecryptedMessage[]): DecryptedMessage[] {
    if (existing.length === 0) {
        return [...incoming].sort(compareMessages)
    }
    if (incoming.length === 0) {
        return [...existing].sort(compareMessages)
    }

    const byId = new Map<string, DecryptedMessage>()
    for (const msg of existing) {
        byId.set(msg.id, msg)
    }
    for (const msg of incoming) {
        byId.set(msg.id, msg)
    }

    let merged = Array.from(byId.values())

    const incomingStoredLocalIds = new Set<string>()
    for (const msg of incoming) {
        if (msg.localId && !isOptimisticMessage(msg)) {
            incomingStoredLocalIds.add(msg.localId)
        }
    }

    // 如果收到带有 localId 的已存储消息，删除相同 localId 的乐观更新消息
    if (incomingStoredLocalIds.size > 0) {
        merged = merged.filter((msg) => {
            if (!msg.localId || !incomingStoredLocalIds.has(msg.localId)) {
                return true
            }
            return !isOptimisticMessage(msg)
        })
    }

    // 后备处理：如果乐观更新消息标记为已发送但没有收到 localId 回显，
    // 当服务器用户消息出现且时间接近时，删除该乐观更新消息
    const optimisticMessages = merged.filter((m) => isOptimisticMessage(m))
    const nonOptimisticMessages = merged.filter((m) => !isOptimisticMessage(m))
    const result: DecryptedMessage[] = [...nonOptimisticMessages]

    for (const optimistic of optimisticMessages) {
        if (optimistic.status === 'sent') {
            const hasServerUserMessage = nonOptimisticMessages.some((m) =>
                isUserMessage(m) &&
                Math.abs(m.createdAt - optimistic.createdAt) < 10_000
            )
            if (hasServerUserMessage) {
                continue
            }
        }
        result.push(optimistic)
    }

    result.sort(compareMessages)
    return result
}

/**
 * 在缓存中更新/插入消息
 */
export function upsertMessagesInCache(
    data: InfiniteData<MessagesResponse> | undefined,
    incoming: DecryptedMessage[],
): InfiniteData<MessagesResponse> {
    const mergedIncoming = mergeMessages([], incoming)

    if (!data || data.pages.length === 0) {
        return {
            pages: [
                {
                    messages: mergedIncoming,
                    page: {
                        limit: 50,
                        beforeSeq: null,
                        nextBeforeSeq: null,
                        hasMore: false,
                    },
                },
            ],
            pageParams: [null],
        }
    }

    const pages = data.pages.slice()
    const first = pages[0]
    pages[0] = {
        ...first,
        messages: mergeMessages(first.messages, mergedIncoming),
    }

    return {
        ...data,
        pages,
    }
}
