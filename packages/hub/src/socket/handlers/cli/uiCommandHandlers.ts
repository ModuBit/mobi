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

import { z } from 'zod'
import { UiCommandActionSchema, type ClientToServerEvents } from '@mobi/shared'
import { hubLogger } from '../../../logger'
import type { CliSocketWithData } from '../../socketTypes'
import type { AccessResult } from './types'
import type { StoredSession } from '../../../store'
import type { SyncEvent } from '../../../sync/syncEngine'

type SendUiCommandHandler = ClientToServerEvents['sendUiCommand']

const sendUiCommandSchema = z.object({
    sid: z.string(),
    action: UiCommandActionSchema,
})

export type UiCommandHandlersDeps = {
    resolveSessionAccess: (sessionId: string) => AccessResult<StoredSession>
    /** Web SSE 在线检查（hidden 后台 tab 也算在线，D6 广播语义） */
    hasActiveSseConnection: (namespace: string) => boolean
    /** ui-command SyncEvent 发布（经 EventPublisher 盖章 namespace 并 SSE 广播） */
    publishUiCommand?: (event: Extract<SyncEvent, { type: 'ui-command' }>) => void
}

/**
 * sendUiCommand handler（agent-apps 首切片，CLI→Hub 的 UI 命令入口）。
 *
 * 回执语义（handler 返回值即 socket.io ack，Web 不参与）：
 * - 有活跃 Web 连接 → 发布 ui-command SyncEvent，ack { delivered: true }
 *   （delivered=已广播，非"用户已看到"）
 * - 无连接 → ack { delivered: false, reason: 'no-web-online' }，不广播不落库
 *   （离线是调用成功非错误，CLI 转平和反馈；socket 断开/ack 超时由 emitWithAck
 *   reject 体现，属连接故障，与本离线分支区分）
 * - 瞬态事件：不落库、不进快照、刷新不恢复（spec D9）
 */
export function registerUiCommandHandlers(socket: CliSocketWithData, deps: UiCommandHandlersDeps): void {
    const { resolveSessionAccess, hasActiveSseConnection, publishUiCommand } = deps

    socket.on('sendUiCommand', ((raw: unknown, cb: Parameters<SendUiCommandHandler>[1]) => {
        const parsed = sendUiCommandSchema.safeParse(raw)
        if (!parsed.success) {
            cb?.({ delivered: false, reason: 'invalid-payload' })
            return
        }

        const access = resolveSessionAccess(parsed.data.sid)
        if (!access.ok) {
            cb?.({ delivered: false, reason: access.reason })
            return
        }

        if (!hasActiveSseConnection(access.value.namespace)) {
            cb?.({ delivered: false, reason: 'no-web-online' })
            return
        }

        // 装配守卫：发布入口缺失属组装 bug，绝不能静默丢弃后仍回"已广播"
        if (!publishUiCommand) {
            hubLogger.error('[UiCommand] publishUiCommand 未装配，ui-command 被丢弃')
            cb?.({ delivered: false, reason: 'handler-misconfigured' })
            return
        }

        publishUiCommand({
            type: 'ui-command',
            // 信封盖章：投递路由元数据由 Hub 从鉴权过的会话解析填充（权威 id + namespace），
            // CLI 不填。namespace 必盖——session 无关动作缺省 sessionId 时 resolveNamespace
            // 无回查依据，靠它保证事件仍路由到本 namespace 全部连接
            namespace: access.value.namespace,
            sessionId: access.value.id,
            action: parsed.data.action,
        })
        cb?.({ delivered: true })
    }) as SendUiCommandHandler)
}
