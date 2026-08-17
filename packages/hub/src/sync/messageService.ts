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

import type { AttachmentMetadata, DecryptedMessage } from '@mobi/shared/types'
import type { Server } from 'socket.io'
import type { Store, StoredMessage } from '../store'
import { EventPublisher } from './eventPublisher'

/**
 * StoredMessage → 对外 DTO 的唯一映射。所有向 web/CLI 下发消息的出口
 * （历史查询、new-message update、message-received 事件）必须复用此处，
 * 新增消息字段时只改这一处，避免多处内联展开形状静默分叉。
 * metadata（nativeId / nativeSessionId）从 StoredMessage 直出，供 Web 端 rewind 判据
 */
export function toDecryptedMessage(message: StoredMessage): DecryptedMessage {
    return {
        id: message.id,
        seq: message.seq,
        localId: message.localId,
        metadata: message.metadata,
        submittedAt: message.submittedAt,
        queueState: message.queueState,
        positionAt: message.positionAt,
        content: message.content,
        createdAt: message.createdAt,
    }
}

export class MessageService {
    private static readonly toDecrypted = toDecryptedMessage

    constructor(
        private readonly store: Store,
        private readonly io: Server,
        private readonly publisher: EventPublisher
    ) {
    }

    getMessagesPage(sessionId: string, options: { limit: number; beforeSeq: number | null }): {
        messages: DecryptedMessage[]
        page: {
            limit: number
            beforeSeq: number | null
            nextBeforeSeq: number | null
            hasMore: boolean
        }
    } {
        const stored = this.store.messages.getMessages(sessionId, options.limit, options.beforeSeq ?? undefined, true)
        const messages: DecryptedMessage[] = stored.map(MessageService.toDecrypted)

        // 首页：out-of-band 钉入仍排队的本地 user 消息（悬浮条）
        // getUnsubmittedLocalMessages 返回 seq ASC，追加到列表尾部，不参与 nextBeforeSeq/hasMore 计算
        if (options.beforeSeq === null || options.beforeSeq === undefined) {
            const inPageIds = new Set(stored.map(r => r.id))
            const unsubmitted = this.store.messages.getUnsubmittedLocalMessages(sessionId)
                .filter(m => !inPageIds.has(m.id))
                .map(MessageService.toDecrypted)
            messages.push(...unsubmitted)
        }

        // 游标锚点 = 页内最老消息的 seq（不分 queue_state）。
        // 不跳过 pending：否则整页全 pending 时 oldestSeq=null → hasMore=false，更早历史被锁死。
        // pending 锚点的 position_at 会在消费时跳变，但游标语义是「翻到此 seq 之前」，漂移只会让
        // 下一页多含若干已取消息，由 mergeMessages 的 id 去重兜底，不丢消息、不重复。
        let oldestSeq: number | null = null
        for (const message of stored) {
            if (typeof message.seq !== 'number') continue
            if (oldestSeq === null || message.seq < oldestSeq) {
                oldestSeq = message.seq
            }
        }

        const nextBeforeSeq = oldestSeq
        const hasMore = nextBeforeSeq !== null
            && this.store.messages.getMessages(sessionId, 1, nextBeforeSeq, true).length > 0

        return {
            messages,
            page: {
                limit: options.limit,
                beforeSeq: options.beforeSeq,
                nextBeforeSeq,
                hasMore
            }
        }
    }

    getMessagesAfter(sessionId: string, options: { afterSeq: number; limit: number }): DecryptedMessage[] {
        const stored = this.store.messages.getMessagesAfter(sessionId, options.afterSeq, options.limit)
        return stored.map(MessageService.toDecrypted)
    }

    getSidechainMessages(sessionId: string, parentToolUseId: string): DecryptedMessage[] {
        const stored = this.store.messages.getSidechainMessages(sessionId, parentToolUseId)
        return stored.map(MessageService.toDecrypted)
    }

    async sendMessage(
        sessionId: string,
        payload: {
            text: string
            localId?: string | null
            attachments?: AttachmentMetadata[]
            sentFrom?: 'webapp' | 'cli'
        }
    ): Promise<void> {
        const sentFrom = payload.sentFrom ?? 'webapp'

        const content = {
            role: 'user',
            content: {
                type: 'text',
                text: payload.text,
                attachments: payload.attachments
            },
            meta: {
                sentFrom
            }
        }

        const msg = this.store.messages.addMessage(sessionId, content, payload.localId ?? undefined)
        const message = toDecryptedMessage(msg)

        const update = {
            id: msg.id,
            seq: msg.seq,
            createdAt: msg.createdAt,
            body: {
                t: 'new-message' as const,
                sid: sessionId,
                message
            }
        }
        this.io.of('/cli').to(`session:${sessionId}`).emit('update', update)

        this.publisher.emit({
            type: 'message-received',
            sessionId,
            message
        })
    }

    /** 标记 localId 对应的排队消息为「已消费」（submittedAt 落库），返回实际更新的 localId 列表 */
    markMessagesSubmitted(sessionId: string, localIds: string[], submittedAt: number): string[] {
        return this.store.messages.markMessagesSubmitted(sessionId, localIds, submittedAt)
    }

    /** 取消仍排队的消息（物理删除）；已 invoke 的不动 */
    cancelQueuedMessage(sessionId: string, localId: string): { cancelled: boolean; submitted: boolean } {
        return this.store.messages.cancelQueuedMessage(sessionId, localId)
    }

    /** 查询某 localId 消息的提交状态（非破坏性，用于 steer 前置校验） */
    getMessageSubmitState(sessionId: string, localId: string): { exists: boolean, submitted: boolean } {
        return this.store.messages.getMessageSubmitState(sessionId, localId)
    }
}
