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
 * AgentSessionService（整个能力对象一次交付，见 deps）。
 *
 * 鉴权模型与 ui-command 一致：namespace 由 Hub 从**鉴权过的 sid** 解析，
 * CLI 不填、也不可信——agent 因此只能看到自己 namespace 内的资源。
 */

import { z } from 'zod'
import { EFFORT_LEVELS, PermissionModeSchema } from '@mobi/shared'
import type { ClientToServerEvents } from '@mobi/shared'
import { hubLogger } from '../../../logger'
import type { CliSocketWithData } from '../../socketTypes'
import type { AccessErrorReason, AccessResult } from './types'
import type { StoredSession } from '../../../store'
import type { AgentSessionOps } from '../../../sync/agentSessionService'

type ListMachinesForAgentHandler = ClientToServerEvents['listMachinesForAgent']
type ListSessionsForAgentHandler = ClientToServerEvents['listSessionsForAgent']
type CreateSessionForAgentHandler = ClientToServerEvents['createSessionForAgent']
type SendMessageForAgentHandler = ClientToServerEvents['sendMessageToSessionForAgent']

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
    // 长度上限与 Web 侧改名同一规则（那边是 255）；标题是给人看的短标签，不是正文
    title: z.string().min(1).max(255).optional(),
    // 只校验形状；默认值与等待预算都是业务规则，归 AgentSessionService 一处（同 limit 的取舍）
    waitForReady: z.boolean().optional(),
})

/**
 * targets 只校验形状（非空数组 + 每项非空）。
 *
 * **content 在这里不判**：内容词汇表、以及「本期哪种 block 不受支持」都是业务规则，
 * 只归 AgentSessionService 一处——那里的判据要能说出**是哪个 block** 不受支持，
 * 在这里判只剩一个 reason 码，agent 拿不到能据以改的那句话。
 */
const sendMessagePayloadSchema = z.object({
    sid: z.string(),
    targets: z.array(z.string().min(1)).min(1),
    content: z.unknown(),
})

/** 结构性故障的文案：与上游失败共用 `error` 字段（见 AgentCreateSessionAck 注释），
 *  但必须说清「这不是你做错了」——否则 agent 会反复改入参重试一个改不好的东西 */
const INVALID_ARGUMENTS_ERROR = 'The request was rejected by mobi hub: invalid arguments.'
const SERVICE_UNAVAILABLE_ERROR =
    'The request was rejected by mobi hub: the session service is not available. ' +
    'This is a mobi bug, not something you did — do not retry.'

/**
 * 「发问的会话本身没过鉴权」的文案（create_session 的 `error` 字段）。
 *
 * **不能笼统回 invalid arguments**：那会让 agent 去改 machineId / directory / title 反复
 * 重试一个改不好的东西，而问题在 mobi 对「发问的那个会话」的认定上，与入参无关
 *（list / send 三分支回的是 access.reason，口径本就不同）。
 *
 * 分两句是因为**处置不同**：not-found = 那个会话已经没了；另两种 = mobi 没认出它的身份。
 * 两者都不是重试能解决的，所以都写明别重试。
 */
function callerRejectedError(reason: AccessErrorReason): string {
    return reason === 'not-found'
        ? 'The session that asked is no longer registered with mobi, so it cannot start new sessions. ' +
          'This is about that session, not your arguments — do not retry.'
        : 'mobi could not identify the session that asked. ' +
          'This is a mobi problem, not something you did — do not retry.'
}

export type AgentSessionHandlersDeps = {
    resolveSessionAccess: (sessionId: string) => AccessResult<StoredSession>
    /**
     * Agent 会话操作能力（AgentSessionService 的四个方法，**整份一次交付**）。
     *
     * 缺席是**装配期**的事实（组装 bug），判定只做一次——见 registerAgentSessionHandlers
     * 顶部。所以每个 handler 各自只有一条代码路径，四个方法名也不再逐层改名。
     */
    agentSessions?: AgentSessionOps
}

/** 服务缺席时四个事件的 ack 形状：与上游失败共用 `error`/`reason` 两个字段（见各自 ack 注释） */
type UnavailableReply = { ok: false; reason: string } | { ok: false; error: string }

type AgentSessionEventName =
    | 'listMachinesForAgent'
    | 'listSessionsForAgent'
    | 'createSessionForAgent'
    | 'sendMessageToSessionForAgent'

/**
 * 服务缺席时四个事件各回什么——一个事实，一张表。
 *
 * **不能干脆不注册这几个事件**：CLI 的 emitWithAck 等的是一个永远不来的回执，
 * agent 那边只剩超时，连线索都没有。
 *
 * 回执也必须写明「这是 mobi 的问题、别重试」（同 callerRejectedError 的理由）：
 * 笼统回 invalid arguments 会让 agent 反复改入参，去重试一个改不好的东西。
 */
const UNAVAILABLE_REPLIES: ReadonlyArray<{ event: AgentSessionEventName; reply: UnavailableReply }> = [
    { event: 'listMachinesForAgent', reply: { ok: false, reason: 'handler-misconfigured' } },
    { event: 'listSessionsForAgent', reply: { ok: false, reason: 'handler-misconfigured' } },
    { event: 'createSessionForAgent', reply: { ok: false, error: SERVICE_UNAVAILABLE_ERROR } },
    { event: 'sendMessageToSessionForAgent', reply: { ok: false, reason: 'handler-misconfigured' } },
]

/**
 * 服务缺席时的四个 handler（组装的兜底路径）。
 *
 * 注意这**不是**「没装配就静默回空清单」：回的是明确的拒绝，且写明是 mobi 的问题——
 * 空清单会把「服务没接上」伪装成「一台机器都没有」。
 */
function registerUnavailableAgentSessionHandlers(socket: CliSocketWithData): void {
    hubLogger.error('[AgentSessions] 服务未装配，四个事件一律被拒（组装 bug）')
    for (const { event, reply } of UNAVAILABLE_REPLIES) {
        // 四个事件的 ack 签名各不相同，表驱动跨过了事件联合类型——一次显式 cast，
        // 与文件里逐 handler 的 `as XxxHandler` 同类
        socket.on(event, ((_raw: unknown, cb?: (answer: UnavailableReply) => void) => cb?.(reply)) as never)
    }
}

/**
 * 注册四个 B 类事件。
 *
 * 失败分支一律走 ack 的 ok:false + reason，不抛异常——emitWithAck 的 reject
 * 留给连接故障，两者语义不同（与 ui-command 同口径）。
 */
export function registerAgentSessionHandlers(socket: CliSocketWithData, deps: AgentSessionHandlersDeps): void {
    const { resolveSessionAccess, agentSessions } = deps

    // 服务在不在是装配期的事实（组装 bug），这里判一次就够——往下走各 handler 都是单一路径
    if (!agentSessions) {
        registerUnavailableAgentSessionHandlers(socket)
        return
    }

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

        cb?.({ ok: true, machines: agentSessions.listMachines(access.value.namespace) })
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

        const { sid: _sid, ...query } = parsed.data
        cb?.({ ok: true, sessions: agentSessions.listSessions(access.value.namespace, query) })
    }) as ListSessionsForAgentHandler)

    socket.on('createSessionForAgent', (async (raw: unknown, cb: Parameters<CreateSessionForAgentHandler>[1]) => {
        const parsed = createSessionPayloadSchema.safeParse(raw)
        if (!parsed.success) {
            cb?.({ ok: false, error: INVALID_ARGUMENTS_ERROR })
            return
        }

        const access = resolveSessionAccess(parsed.data.sid)
        if (!access.ok) {
            cb?.({ ok: false, error: callerRejectedError(access.reason) })
            return
        }

        const { sid: _sid, ...input } = parsed.data
        cb?.(await agentSessions.createSession(access.value.namespace, input))
    }) as CreateSessionForAgentHandler)

    socket.on('sendMessageToSessionForAgent', (async (raw: unknown, cb: Parameters<SendMessageForAgentHandler>[1]) => {
        const parsed = sendMessagePayloadSchema.safeParse(raw)
        if (!parsed.success) {
            cb?.({ ok: false, reason: 'invalid-payload' })
            return
        }

        const access = resolveSessionAccess(parsed.data.sid)
        if (!access.ok) {
            cb?.({ ok: false, reason: access.reason })
            return
        }

        // 一次扇出等所有目标各自走完一轮 RPC，慢是正常的（每个目标一次往返，最多 30s 超时）。
        // 逐条结果由服务给出，顶层恒 ok——进了扇出就没有「整体失败」这回事
        const { sid, ...input } = parsed.data
        cb?.({ ok: true, results: await agentSessions.sendMessageToSessions(access.value.namespace, sid, input) })
    }) as SendMessageForAgentHandler)
}
