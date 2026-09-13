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

import { isMobiDelivered, normalizeUserContent, toCrossSessionMeta } from '@mobi/shared'
import type { CrossSessionOrigin } from '@mobi/shared'
import type { DecryptedMessage } from '@mobi/shared/types'
import type { Server } from 'socket.io'
import type { Store, StoredMessage } from '../store'
import type { MarkPushedResult } from '../store/messages'
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

/**
 * sendMessage 入参（含透传方 SyncEngine 的签名——字段只在这一处声明，
 * 新增字段不会被透传层漏掉）。
 */
export type SendMessagePayload = {
    /** 内容三形态之一（string / 单 block / block 数组，或旧平铺对象），透传给 messageService 归一 */
    content: unknown
    localId?: string | null
    sentFrom?: 'webapp' | 'cli'
    /**
     * 跨会话来源身份（agent 经 send_message_to_session 投来的消息）。
     *
     * 收的是 concept 本身而不是摊开的字段（架构评审候选 #1）：写进 meta 的形状由
     * `toCrossSessionMeta` 一处决定，此处不再复述「name 进 crossSession.from、id 作顶层
     * 一等字段」这套摆位——那正是此前四个包各写一遍的东西。
     */
    origin?: CrossSessionOrigin
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
        payload: SendMessagePayload
    ): Promise<void> {
        const sentFrom = payload.sentFrom ?? 'webapp'
        // 「没有来源」在这一层就归一成 null（写入投影与回灌判据都按它分支）
        const origin = payload.origin ?? null

        // 写入侧格式单一化：三形态统一归一为 UserContentBlock[] 再落库（读取侧零分叉）
        const blocks = normalizeUserContent(payload.content)
        if (!blocks || blocks.length === 0) {
            throw new Error('Invalid message content')
        }

        const content = {
            role: 'user',
            content: blocks,
            meta: {
                sentFrom,
                ...(origin ? toCrossSessionMeta(origin) : {})
            }
        }

        const msg = this.store.messages.addMessage(sessionId, content, payload.localId ?? undefined)
        const message = toDecryptedMessage(msg)

        // 跨会话投递已经由 push-agent-message RPC 把消息推进目标 CLI 的 input stream，
        // 再回灌一次就是同一句话投两遍。判据与另两处出口同源（shared 的 isMobiDelivered：
        // 有 fromSessionId 才是 mobi 投递的那条路径），不再由调用方传一个布尔标志——
        // 那个标志只有一处调用点会传，却让「什么时候该省这次 emit」散成两个事实。
        if (!isMobiDelivered(origin)) {
            this.emitNewMessageToCli(sessionId, msg, message)
        }

        this.publisher.emit({
            type: 'message-received',
            sessionId,
            message
        })
    }

    /**
     * 补投仍排队（lifecycle='queued'）的用户消息到 CLI 房间（fork 激活翻转时调用）。
     *
     * 入队广播与 CLI 进房存在时序窗：web 发送侧先 fire-and-forget 触发 resume spawn，
     * POST /messages 的房间广播落在 CLI socket join 之前——首连场景下 emit 落空，
     * 消息永久滞留 queued（CLI 的断线 backfill 只覆盖「重连且 lastSeenMessageSeq 非空」）。
     * 在激活翻转点整体补发，body 形态与 sendMessage 逐字段一致；幂等性由两端保证：
     * CLI lastSeenMessageSeq 去重 + 消费后 lifecycle 推进（不再 queued，不会二次补投）。
     * 只重放 CLI 房间，不发 message-received SSE——web 端在入队时已渲染，重复推送会造成
     * 排队条闪烁。
     */
    redeliverQueued(sessionId: string): void {
        const queued = this.store.messages.getUnsubmittedLocalMessages(sessionId)
        if (queued.length === 0) return
        for (const msg of queued) {
            this.emitNewMessageToCli(sessionId, msg, toDecryptedMessage(msg))
        }
    }

    /** 把 localId 对应的 queued 消息推进为 pushed（lifecycle/lifecycleAt 落库 + position 地板），返回实际更新的 localId 与写入的 position_at */
    markMessagesPushed(sessionId: string, localIds: string[], pushedAt: number): MarkPushedResult {
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

    /**
     * CLI 房间 new-message 广播的单一构造点（sendMessage 与 redeliverQueued 共用）：
     * update 载荷形态（id/seq/createdAt/body{t:'new-message',sid,message}）只在此声明，
     * 补投路径与正常入队路径对 CLI 天然一致，无「逐字段对齐」的注释约定负担。
     * 不含 message-received SSE——那由 sendMessage 在调用后按需单独发。
     */
    private emitNewMessageToCli(sessionId: string, msg: { id: string; seq: number | null; createdAt: number }, message: ReturnType<typeof toDecryptedMessage>): void {
        this.io.of('/cli').to(`session:${sessionId}`).emit('session-update', {
            id: msg.id,
            seq: msg.seq,
            createdAt: msg.createdAt,
            body: {
                t: 'new-message' as const,
                sid: sessionId,
                message
            }
        })
    }
}
