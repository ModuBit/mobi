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
 * CLI socket 能力集（架构评审候选⑥票①）：socket 层消费的 daemon 侧会话能力的
 * 单一声明源。
 *
 * 此前同一组能力签名在 SocketServerDeps / CliHandlersDeps / SessionHandlersDeps
 * 手写三遍、注释各养一份（emitCliNewMessage 还是跨三层链式投影）——改一个签名
 * 要跨 4 个文件。factsSink 已单源过一次（sync/sessionFacts.ts，深化候选③），
 * 本文件把其余跨层能力收进同一模式：能力本体一份，三层 deps 只做投影。
 *
 * 组装形态差异（socket server 先于 SyncEngine 创建的真环，见 server.ts）由
 * SocketServerDeps 侧表达：可直传的能力取本体投影，须惰性的能力写 getter 投影。
 */

import type { SyncEvent } from '../sync/syncEngine'
import type { SessionFactsSink } from '../sync/sessionFacts'
import type { AgentSessionOps } from '../sync/agentSessionService'
import type { toDecryptedMessage } from '../sync/messageService'

/** CLI socket 消费的 daemon 会话能力（实体形态；各消费层按需 Partial/Pick 投影） */
export type SessionSocketCapabilities = {
    /** 会话事实上报落库入口（心跳/水位/目标/轮次/结束；声明源 sync/sessionFacts.ts，
     *  实现方 SyncEngine/SessionCache） */
    factsSink: SessionFactsSink
    /** CLI 房间 new-message 广播出口（messageService 单一构造点。此前 handler 内联拼
     *  第二份载荷且信封 id 已分叉（randomUUID vs msg.id）——构造权收归 messageService
     *  后 handler 只传参。缺装配时跳过 CLI 广播（部分单测只关心 SSE 侧），生产装配恒注入） */
    emitCliNewMessage: (
        sessionId: string,
        msg: { id: string; seq: number | null; createdAt: number },
        message: ReturnType<typeof toDecryptedMessage>,
        options?: { backfill?: boolean; exceptSocketId?: string },
    ) => void
    /** Web 端实时事件转发（文件变更/终端输出等 → SyncEngine.handleRealtimeEvent） */
    onWebappEvent: (event: SyncEvent) => void
    /** Web SSE 在线检查（ui-command 离线静默判定；hidden 后台 tab 也算在线） */
    hasActiveSseConnection: (namespace: string) => boolean
    /** ui-command 发布（经 EventPublisher 盖章 namespace 并 SSE 广播） */
    publishUiCommand: (event: Extract<SyncEvent, { type: 'ui-command' }>) => void
    /** Agent 会话操作能力（B 类工具族四方法整份交付；缺装配回 handler-misconfigured，
     *  不静默返回空清单） */
    agentSessions: AgentSessionOps
}

/** 惰性 getter 投影：组装层 socket server 先于 SyncEngine 创建，connection 时解包 */
export type LazyCapability<T> = () => T | undefined
