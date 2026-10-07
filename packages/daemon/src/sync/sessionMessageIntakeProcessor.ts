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

import type { MessageCategory, NativeMessageMetadata } from '@mobi/shared'
import type { RuntimeState } from '@mobi/shared/types'
import type { Store, StoredMessage, StoredSession } from '../store'
import { isContextBoundaryContent } from '../store/messages'
import type { SnapshotSync } from './snapshotSync'
import type { SessionMessageRuntimeProjector } from './sessionMessageRuntimeProjector'

/** 连接级 nsid 补写出口（实现方 SessionMessageFactsProcessor.enrichMetadata——
 *  连接级 native session 上下文的单一所有者不变，受理 module 只消费不持有） */
export type IntakeMetadataEnricher = (
    sessionId: string,
    metadata: NativeMessageMetadata | null,
) => NativeMessageMetadata | null

/** 受理入参：CLI session-message 主路径已校验的字段（adapter 只做载荷校验与访问权，
 *  不再触达任何落库规则） */
export type SessionMessageIntakeInput = {
    sessionId: string
    /** CLI 已在发送端分类的消息类目，缺省 persistent */
    category: MessageCategory
    content: unknown
    localId?: string | null
    /** CLI 带的 native 锚 metadata（nsid 补写由注入的 enricher 完成） */
    metadata: NativeMessageMetadata | null
    /** 审查卡 position 归属声明（归属 result 行 nativeId；锚查不到退回默认落库时刻） */
    positionBeforeResultId?: string
    /** 投影的 namespace 判据（projector 的配对状态要求调用方声明归属） */
    namespace: string
}

/** 受理产出（惰性：每条规则持久化/推进后即产出，消费方边处理边翻译发布） */
export type SessionMessageIntakePublication =
    /** 落库完成、需广播的行（new-message 出口 + message-received SSE） */
    | { type: 'stored-messages'; sessionId: string; messages: StoredMessage[] }
    /** 边界指针推进（web 的 fork/rewind 入口读会话摘要，必须广播驱动缓存失效） */
    | { type: 'session-updated'; sessionId: string; data: StoredSession }
    /** 运行状态投影产出（todos/tasks/teamState 等摘要变化） */
    | { type: 'runtime-state-updated'; sessionId: string; data: { sid: string; runtimeState: RuntimeState } }

/**
 * 消息受理 module：CLI session-message 主路径落库规则的权威入口。
 *
 * 收口四条此前散在 Socket adapter 内联的领域规则——
 * ① nsid 补写（连接级上下文经注入 enricher，防 CLI 本地合成行滞留 attach 孤儿池）；
 * ② position 锚定（审查卡 positionBeforeResultId → 归属 result 行 position_at − 1）；
 * ③ 边界指针推进（contextBoundary 落库 → advance(MAX(seq))，单调幂等在 advance 内部）；
 * ④ 快照流清理时机（终态落库后清同 localId 的流式快照缓存）。
 * 并编排 RuntimeProjector（注入实例，配对状态仍连接级）。
 *
 * Socket adapter 只负责载荷校验、访问权与 publication 翻译（CLI 房间广播出口 +
 * message-received / session-updated SSE）——与 SessionMessageFactsProcessor /
 * SessionMessageRuntimeProjector 同形：规则在此，协议在 adapter。
 */
export class SessionMessageIntakeProcessor {
    constructor(
        private readonly store: Store,
        private readonly snapshotSync: SnapshotSync,
        private readonly runtimeProjector: SessionMessageRuntimeProjector,
        private readonly enrichMetadata: IntakeMetadataEnricher,
    ) {}

    *intake(input: SessionMessageIntakeInput): Generator<SessionMessageIntakePublication> {
        const { sessionId } = input

        // ① nsid 补写：取「本连接已上报」的 nsid；本轮未上报（resume 的 pre-SDK 窗口 /
        // 首条消息前）保持缺省，仍由 attach 兜底——绝不读 session.metadata（跨时代残留旧值）
        const metadata = this.enrichMetadata(sessionId, input.metadata)

        // ② position 锚定（审查卡）：position_at 权威在 daemon——按 CLI 带的归属 result 行
        // nativeId 定位，取该行之前（-1ms）；锚查不到（异常时序）退回默认落库时刻
        const resultPos = input.positionBeforeResultId !== undefined
            ? this.store.messages.getResultPositionAt(sessionId, input.positionBeforeResultId)
            : null
        const positionAt = resultPos !== null ? resultPos - 1 : undefined

        // 落库
        const msg = this.store.messages.addMessage(
            sessionId,
            input.content,
            input.localId ?? undefined,
            input.category,
            metadata,
            positionAt,
        )

        // ④ 终态已持久化：清理同 localId 的流式快照
        this.snapshotSync.messagePersisted(sessionId, input.localId ?? null)

        // ③ 边界指针推进（fork/rewind 入口判据）。两个写入时机：compact_boundary 落库 →
        // 该行 seq；context-cleared 事件到达 → 当前 MAX(seq)。二者刚落库后 MAX 恒含该行
        // seq，统一取 MAX 兼容 resume 重放去重路径下 msg.seq 落后于当前 MAX 的情况；
        // 单调守卫在 advance 内部（不回退、幂等）
        if (isContextBoundaryContent(input.content)) {
            this.store.contextBoundary.advance(sessionId, this.store.messages.getMaxSeq(sessionId))
            // advance 刚写过该会话行，行必在；类型上 getSession 可空，查不到则跳过广播（防御性）
            const stored = this.store.sessions.getSession(sessionId)
            if (stored) yield { type: 'session-updated', sessionId, data: stored }
        }

        // 运行状态投影（注入实例：跨消息配对状态连接级，受理只负责编排顺序）
        for (const runtimeState of this.runtimeProjector.project({
            sessionId,
            namespace: input.namespace,
            content: input.content,
        })) {
            yield { type: 'runtime-state-updated', sessionId, data: { sid: sessionId, runtimeState } }
        }

        yield { type: 'stored-messages', sessionId, messages: [msg] }
    }
}
