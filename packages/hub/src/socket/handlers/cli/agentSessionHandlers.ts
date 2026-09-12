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
 * Agent 会话操作 handler（B 类工具族，CLI→Hub 入口）。
 *
 * 分工：本文件只做外层校验、鉴权、调用服务、把结果转 ack；业务规则全在
 * AgentSessionService（注入的是它的方法，见 deps）。
 *
 * 鉴权模型与 ui-command 一致：namespace 由 Hub 从**鉴权过的 sid** 解析，
 * CLI 不填、也不可信——agent 因此只能看到自己 namespace 内的资源。
 */

import { z } from 'zod'
import type { AgentMachineSummary, ClientToServerEvents } from '@mobi/shared'
import { hubLogger } from '../../../logger'
import type { CliSocketWithData } from '../../socketTypes'
import type { AccessResult } from './types'
import type { StoredSession } from '../../../store'

type ListMachinesForAgentHandler = ClientToServerEvents['listMachinesForAgent']

const listMachinesPayloadSchema = z.object({
    sid: z.string(),
})

export type AgentSessionHandlersDeps = {
    resolveSessionAccess: (sessionId: string) => AccessResult<StoredSession>
    /** AgentSessionService.listMachines（装配缺失属组装 bug，见下方守卫） */
    listOnlineMachines?: (namespace: string) => AgentMachineSummary[]
}

/**
 * listMachinesForAgent handler。
 *
 * 失败分支一律走 ack 的 ok:false + reason，不抛异常——emitWithAck 的 reject
 * 留给连接故障，两者语义不同（与 ui-command 同口径）。
 */
export function registerAgentSessionHandlers(socket: CliSocketWithData, deps: AgentSessionHandlersDeps): void {
    const { resolveSessionAccess, listOnlineMachines } = deps

    socket.on('listMachinesForAgent', ((raw: unknown, cb: Parameters<ListMachinesForAgentHandler>[1]) => {
        const parsed = listMachinesPayloadSchema.safeParse(raw)
        if (!parsed.success) {
            cb?.({ ok: false, reason: 'invalid-payload' })
            return
        }

        const access = resolveSessionAccess(parsed.data.sid)
        if (!access.ok) {
            cb?.({ ok: false, reason: access.reason })
            return
        }

        // 装配守卫：缺装配属组装 bug，绝不能静默返回空清单——那会让 agent
        // 以为"一台机器都没有"，与"服务没接上"混淆
        if (!listOnlineMachines) {
            hubLogger.error('[AgentSessions] listOnlineMachines 未装配，请求被拒')
            cb?.({ ok: false, reason: 'handler-misconfigured' })
            return
        }

        cb?.({ ok: true, machines: listOnlineMachines(access.value.namespace) })
    }) as ListMachinesForAgentHandler)
}
