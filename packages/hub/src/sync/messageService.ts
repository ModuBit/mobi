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

import { normalizeUserContent } from '@mobi/shared'
import type { DecryptedMessage } from '@mobi/shared/types'
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
        lifecycle: message.lifecycle,
        lifecycleAt: message.lifecycleAt,
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

        // 游标锚点 = 页内最老消息的 seq（不分 lifecycle）。
        // 不跳过 queued：否则整页全 queued 时 oldestSeq=null → hasMore=false，更早历史被锁死。
        // queued 锚点的 position_at 会在 push 时跳变，但游标语义是「翻到此 seq 之前」，漂移只会让
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
            /** 内容三形态之一（string / 单 block / block 数组，或旧平铺对象）。路由层已 Zod 校验，service 再归一保底 */
            content: unknown
            localId?: string | null
            sentFrom?: 'webapp' | 'cli'
        }
    ): Promise<void> {
        const sentFrom = payload.sentFrom ?? 'webapp'

        // 写入侧格式单一化：三形态统一归一为 UserContentBlock[] 再落库（读取侧零分叉）
        const blocks = normalizeUserContent(payload.content)
        if (!blocks || blocks.length === 0) {
            throw new Error('Invalid message content')
        }

        const content = {
            role: 'user',
            content: blocks,
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
        this.io.of('/cli').to(`session:${sessionId}`).emit('session-update', update)

        this.publisher.emit({
            type: 'message-received',
            sessionId,
            message
        })
    }

    /** 把 localId 对应的 queued 消息推进为 pushed（lifecycle/lifecycleAt 落库），返回实际更新的 localId 列表 */
    markMessagesPushed(sessionId: string, localIds: string[], pushedAt: number): string[] {
        return this.store.messages.markMessagesPushed(sessionId, localIds, pushedAt)
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
