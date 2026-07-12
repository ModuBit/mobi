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

export class MessageService {
    private static toDecrypted(message: StoredMessage): DecryptedMessage {
        return {
            id: message.id,
            seq: message.seq,
            localId: message.localId,
            invokedAt: message.invokedAt,
            content: message.content,
            createdAt: message.createdAt,
        }
    }

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
        // getUninvokedLocalMessages 返回 seq ASC，追加到列表尾部，不参与 nextBeforeSeq/hasMore 计算
        if (options.beforeSeq === null || options.beforeSeq === undefined) {
            const inPageIds = new Set(stored.map(r => r.id))
            const uninvoked = this.store.messages.getUninvokedLocalMessages(sessionId)
                .filter(m => !inPageIds.has(m.id))
                .map(MessageService.toDecrypted)
            messages.push(...uninvoked)
        }

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

        const update = {
            id: msg.id,
            seq: msg.seq,
            createdAt: msg.createdAt,
            body: {
                t: 'new-message' as const,
                sid: sessionId,
                message: {
                    id: msg.id,
                    seq: msg.seq,
                    createdAt: msg.createdAt,
                    localId: msg.localId,
                    content: msg.content
                }
            }
        }
        this.io.of('/cli').to(`session:${sessionId}`).emit('update', update)

        this.publisher.emit({
            type: 'message-received',
            sessionId,
            message: {
                id: msg.id,
                seq: msg.seq,
                localId: msg.localId,
                content: msg.content,
                createdAt: msg.createdAt
            }
        })
    }

    /** 标记 localId 对应的排队消息为「已消费」（invokedAt 落库），返回实际更新的 localId 列表 */
    markMessagesInvoked(sessionId: string, localIds: string[], invokedAt: number): string[] {
        return this.store.messages.markMessagesInvoked(sessionId, localIds, invokedAt)
    }

    /** 取消仍排队的消息（物理删除）；已 invoke 的不动 */
    cancelQueuedMessage(sessionId: string, localId: string): { cancelled: boolean; invoked: boolean } {
        return this.store.messages.cancelQueuedMessage(sessionId, localId)
    }
}
