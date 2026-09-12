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
import { EFFORT_LEVELS, PermissionModeSchema } from '@mobi/shared'
import type { AgentCreateSessionAck, AgentMachineSummary, AgentSessionSummary, ClientToServerEvents } from '@mobi/shared'
import { hubLogger } from '../../../logger'
import type { CliSocketWithData } from '../../socketTypes'
import type { AccessResult } from './types'
import type { StoredSession } from '../../../store'
import type { AgentCreateSessionInput, AgentSessionQuery } from '../../../sync/agentSessionService'

type ListMachinesForAgentHandler = ClientToServerEvents['listMachinesForAgent']
type ListSessionsForAgentHandler = ClientToServerEvents['listSessionsForAgent']
type CreateSessionForAgentHandler = ClientToServerEvents['createSessionForAgent']

const listMachinesPayloadSchema = z.object({
    sid: z.string(),
})

/**
 * 入参只校验**形状**，不校验 limit 的取值区间——「上限 50、超出按上限截断」
 * 是业务规则，只由 AgentSessionService 一处决定（工具 schema 负责在模型侧
 * 提前给出合法区间，两处职责不同，别把规则也抄一份到这里）。
 */
const listSessionsPayloadSchema = z.object({
    sid: z.string(),
    keyword: z.string().optional(),
    status: z.enum(['ACTIVE', 'INACTIVE', 'ALL']).optional(),
    limit: z.number().int().optional(),
    projectId: z.string().optional(),
})

/** machineId / directory 非空：空串会一路走到 spawn 才炸，在这里挡下来更清楚 */
const createSessionPayloadSchema = z.object({
    sid: z.string(),
    machineId: z.string().min(1),
    directory: z.string().min(1),
    projectId: z.string().optional(),
    model: z.string().optional(),
    effort: z.enum(EFFORT_LEVELS).optional(),
    permissionMode: PermissionModeSchema.optional(),
})

/** 结构性故障的文案：与上游失败共用 `error` 字段（见 AgentCreateSessionAck 注释），
 *  但必须说清「这不是你做错了」——否则 agent 会反复改入参重试一个改不好的东西 */
const INVALID_ARGUMENTS_ERROR = 'The request was rejected by mobi hub: invalid arguments.'
const SERVICE_UNAVAILABLE_ERROR =
    'The request was rejected by mobi hub: the session service is not available. ' +
    'This is a mobi bug, not something you did — do not retry.'

export type AgentSessionHandlersDeps = {
    resolveSessionAccess: (sessionId: string) => AccessResult<StoredSession>
    /** AgentSessionService.listMachines（装配缺失属组装 bug，见下方守卫） */
    listOnlineMachines?: (namespace: string) => AgentMachineSummary[]
    /** AgentSessionService.listSessions（同上） */
    listSessions?: (namespace: string, query: AgentSessionQuery) => AgentSessionSummary[]
    /** AgentSessionService.createSession（同上） */
    createSession?: (namespace: string, input: AgentCreateSessionInput) => Promise<AgentCreateSessionAck>
}

/**
 * listMachinesForAgent handler。
 *
 * 失败分支一律走 ack 的 ok:false + reason，不抛异常——emitWithAck 的 reject
 * 留给连接故障，两者语义不同（与 ui-command 同口径）。
 */
export function registerAgentSessionHandlers(socket: CliSocketWithData, deps: AgentSessionHandlersDeps): void {
    const { resolveSessionAccess, listOnlineMachines, listSessions, createSession } = deps

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

    socket.on('listSessionsForAgent', ((raw: unknown, cb: Parameters<ListSessionsForAgentHandler>[1]) => {
        const parsed = listSessionsPayloadSchema.safeParse(raw)
        if (!parsed.success) {
            cb?.({ ok: false, reason: 'invalid-payload' })
            return
        }

        const access = resolveSessionAccess(parsed.data.sid)
        if (!access.ok) {
            cb?.({ ok: false, reason: access.reason })
            return
        }

        // 守卫同 listMachinesForAgent：空清单是"真的没有"，缺装配是"服务没接上"，
        // 两者绝不能混为一谈
        if (!listSessions) {
            hubLogger.error('[AgentSessions] listSessions 未装配，请求被拒')
            cb?.({ ok: false, reason: 'handler-misconfigured' })
            return
        }

        const { sid: _sid, ...query } = parsed.data
        cb?.({ ok: true, sessions: listSessions(access.value.namespace, query) })
    }) as ListSessionsForAgentHandler)

    socket.on('createSessionForAgent', (async (raw: unknown, cb: Parameters<CreateSessionForAgentHandler>[1]) => {
        const parsed = createSessionPayloadSchema.safeParse(raw)
        if (!parsed.success) {
            cb?.({ ok: false, error: INVALID_ARGUMENTS_ERROR })
            return
        }

        const access = resolveSessionAccess(parsed.data.sid)
        if (!access.ok) {
            cb?.({ ok: false, error: INVALID_ARGUMENTS_ERROR })
            return
        }

        if (!createSession) {
            hubLogger.error('[AgentSessions] createSession 未装配，请求被拒')
            cb?.({ ok: false, error: SERVICE_UNAVAILABLE_ERROR })
            return
        }

        const { sid: _sid, ...input } = parsed.data
        cb?.(await createSession(access.value.namespace, input))
    }) as CreateSessionForAgentHandler)
}
