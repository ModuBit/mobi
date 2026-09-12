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
import type { PermissionMode, EffortLevel } from './modes'
import type { MessageCategory } from './messageClassification'
import type { MessageFact } from './messages'
import type { CacheStatus, ContextUsage, GoalStatus, SnapshotDeltaFrame, UiCommandAction } from './schemas'

export type SocketErrorReason = 'namespace-missing' | 'access-denied' | 'not-found'

/** mobi 内置 MCP server 名（工具全名 = mcp__<server>__<tool>；server 拆分见 cli sessionTransports，
 *  web 渲染层匹配当前工具全名时从这里派生，历史落库名除外） */
export const MOBI_APPS_SERVER_NAME = 'mobi-apps'
export const MOBI_CORE_SERVER_NAME = 'mobi-core'

/** UI 命令回执（sendUiCommand 的 ack 载荷） */
export type UiCommandAck = {
    delivered: boolean
    reason?: string
}

/**
 * B 类（agent 会话操作）的失败原因。
 *
 * 与 SocketErrorReason 同源，另加两类**组装/入参**故障——这两类是编程错误而非
 * 访问问题，消费方不该把它们与"没权限"混为一谈。
 */
export type AgentOpFailureReason =
    | SocketErrorReason
    | 'invalid-payload'
    | 'handler-misconfigured'

/** 在线机器摘要（agent 视角：只给能派活的目标，不含离线候选） */
export type AgentMachineSummary = {
    machineId: string
    /** 展示名：机器自报 displayName，缺省回退 host */
    name: string
    hostname: string
    /** 最近心跳时刻（ms） */
    activeAt: number
}

/**
 * list machines 回执。判别联合而非可选字段：成功分支必带清单，
 * 消费方无需对 machines 判空（与 UiCommandAck 的 delivered+reason? 形态不同，
 * 因为这里没有"成功但结果为空"与"失败"的语义混淆空间）。
 */
export type AgentMachinesAck =
    | { ok: true; machines: AgentMachineSummary[] }
    | { ok: false; reason: AgentOpFailureReason }

/**
 * list_sessions 的 status 三档。
 *
 * **默认 ACTIVE**：agent 要派活就得找活着的会话——未激活的进程已经不在了，
 * 发消息必然失败。INACTIVE 存在的意义是让 agent 能区分「没有这个会话」与
 * 「有，但它没在跑」，而不是拿它当派活目标。
 */
export type AgentSessionStatus = 'ACTIVE' | 'INACTIVE' | 'ALL'

/** 会话摘要（agent 视角：够它挑出派活目标，不含 UI 呈现用的进度类字段） */
export type AgentSessionSummary = {
    sessionId: string
    /** 人写的标题。可能缺失、可能重名、**且会变**——只作展示，绝不当 id 用 */
    name?: string
    /** 会话摘要（目前主要由 change_title 写入），信息量弱，只作辅助匹配 */
    summary?: string
    /** 归属项目（null = 游离） */
    projectId: string | null
    /**
     * 所在机器。metadata 里没有时**缺省**，不拿 host 顶替——host 是主机名不是机器 id，
     * 顶替出来的值拿去 create_session 只会得到一个必然失败的入参。
     */
    machineId?: string
    /** 工作目录。metadata 解析失败时缺省（不填假值） */
    path?: string
    /** 该会话的 CLI 进程是否还活着（Hub 内存态，非落库字段） */
    active: boolean
    /** 此刻是否有 turn 在跑 */
    running: boolean
    updatedAt: number
    /** 模型（来自 runtimeState，缺省 = 尚未上报） */
    model?: string
    pinned: boolean
}

/** list sessions 回执。判别联合，理由同 AgentMachinesAck */
export type AgentSessionsAck =
    | { ok: true; sessions: AgentSessionSummary[] }
    | { ok: false; reason: AgentOpFailureReason }

/**
 * list_sessions 的 limit 默认值与上限。
 *
 * 放协议层而不是 Hub 侧：工具 schema（给模型的契约）与 Hub 侧截断规则必须同源，
 * 各写一份必然漂移——模型看到的上限与真正生效的上限对不上是最难查的那类 bug。
 */
export const AGENT_SESSIONS_DEFAULT_LIMIT = 20
export const AGENT_SESSIONS_MAX_LIMIT = 50

export const TerminalOpenPayloadSchema = z.object({
    sessionId: z.string().min(1),
    terminalId: z.string().min(1),
    cols: z.number().int().positive(),
    rows: z.number().int().positive()
})

export type TerminalOpenPayload = z.infer<typeof TerminalOpenPayloadSchema>

export const TerminalWritePayloadSchema = z.object({
    sessionId: z.string().min(1),
    terminalId: z.string().min(1),
    data: z.string()
})

export type TerminalWritePayload = z.infer<typeof TerminalWritePayloadSchema>

export const TerminalResizePayloadSchema = z.object({
    sessionId: z.string().min(1),
    terminalId: z.string().min(1),
    cols: z.number().int().positive(),
    rows: z.number().int().positive()
})

export type TerminalResizePayload = z.infer<typeof TerminalResizePayloadSchema>

export const TerminalClosePayloadSchema = z.object({
    sessionId: z.string().min(1),
    terminalId: z.string().min(1)
})

export type TerminalClosePayload = z.infer<typeof TerminalClosePayloadSchema>

export const TerminalReadyPayloadSchema = z.object({
    sessionId: z.string().min(1),
    terminalId: z.string().min(1)
})

export type TerminalReadyPayload = z.infer<typeof TerminalReadyPayloadSchema>

export const TerminalOutputPayloadSchema = z.object({
    sessionId: z.string().min(1),
    terminalId: z.string().min(1),
    data: z.string()
})

export type TerminalOutputPayload = z.infer<typeof TerminalOutputPayloadSchema>

export const TerminalExitPayloadSchema = z.object({
    sessionId: z.string().min(1),
    terminalId: z.string().min(1),
    code: z.number().int().nullable(),
    signal: z.string().nullable()
})

export type TerminalExitPayload = z.infer<typeof TerminalExitPayloadSchema>

export const TerminalErrorPayloadSchema = z.object({
    sessionId: z.string().min(1),
    terminalId: z.string().min(1),
    message: z.string()
})

export type TerminalErrorPayload = z.infer<typeof TerminalErrorPayloadSchema>

export const UpdateNewMessageBodySchema = z.object({
    t: z.literal('new-message'),
    sid: z.string(),
    message: z.object({
        id: z.string(),
        seq: z.number(),
        createdAt: z.number(),
        localId: z.string().nullable().optional(),
        content: z.unknown()
    }),
    /** 补写回填标记（hub attach 路径）：与 SSE 侧 SyncEventSchema message-received 的
     *  backfill 同义——标识历史行重播而非新消息，消费方据此只 merge 不 append */
    backfill: z.boolean().optional()
})

export type UpdateNewMessageBody = z.infer<typeof UpdateNewMessageBodySchema>

export const UpdateSessionBodySchema = z.object({
    t: z.literal('update-session'),
    sid: z.string(),
    metadata: z.object({
        version: z.number(),
        value: z.unknown()
    }).nullable(),
    agentState: z.object({
        version: z.number(),
        value: z.unknown().nullable()
    }).nullable()
})

export type UpdateSessionBody = z.infer<typeof UpdateSessionBodySchema>

export const UpdateMachineBodySchema = z.object({
    t: z.literal('update-machine'),
    machineId: z.string(),
    metadata: z.object({
        version: z.number(),
        value: z.unknown()
    }).nullable(),
    runnerState: z.object({
        version: z.number(),
        value: z.unknown().nullable()
    }).nullable()
})

export type UpdateMachineBody = z.infer<typeof UpdateMachineBodySchema>

export const UpdateSchema = z.object({
    id: z.string(),
    seq: z.number(),
    body: z.union([UpdateNewMessageBodySchema, UpdateSessionBodySchema, UpdateMachineBodySchema]),
    createdAt: z.number()
})

export type Update = z.infer<typeof UpdateSchema>

export interface ServerToClientEvents {
    /** Hub→CLI 会话推送（session room）：new-message / update-session 三种 body，按 body.t 判别 */
    'session-update': (data: Update) => void
    /** Hub→CLI 机器推送（machine room）：update-machine body */
    'machine-update': (data: Update) => void
    'rpc-request': (data: { method: string; params: unknown }, callback: (response: unknown) => void) => void
    'terminal:open': (data: TerminalOpenPayload) => void
    'terminal:write': (data: TerminalWritePayload) => void
    'terminal:resize': (data: TerminalResizePayload) => void
    'terminal:close': (data: TerminalClosePayload) => void
    error: (data: { message: string; code?: SocketErrorReason; scope?: 'session' | 'machine'; id?: string }) => void
}

/** 消息的上游 native 事实（rewind 锚点）——nativeId 为 transcript 消息 uuid；nativeSessionId 为所属
 * 上游 session uuid（新会话首批用户消息 push 时可能未知，可空，待 attach 补写） */
export interface NativeMessageMetadata {
    nativeId?: string
    nativeSessionId?: string
    /** CC 接收确认时刻（isReplay 回显落点）；缺省 = 未确认（不可 rewind） */
    nativeAckAt?: number
    /** command_lifecycle 终态的 terminal_reason（开放透传，web 只解释已知 key，spec §7.6） */
    terminalReason?: string
}

export interface ClientToServerEvents {
    /** CLI→Hub 会话消息落库主通道（agent output / agent event / snapshot 透传，按 content 判别） */
    'session-message': (data: {
        sid: string
        message: unknown
        localId?: string
        metadata?: NativeMessageMetadata
        snapshot?: boolean
        /** 全量帧的 rev 标记（delta 协议）：新 CLI 携带，缺省 = legacy 全量（老协议直通） */
        frame?: { rev: number; baseRev: null }
        /** 增量帧（delta 协议）：携带时 message 字段缺省，hub 走拼接器路径。
         *  同时携带 snapshot:true——老 hub（无 delta 分支）至少按快照透传处理而非误落库
         *  （混版本防 transcript 污染）；新 hub 分支顺序 snapshotDelta 优先，不受影响 */
        snapshotDelta?: SnapshotDeltaFrame
        category?: MessageCategory
    }) => void
    /** snapshot 流结束信号（delta 协议）：full message 已持久化，hub 据此精确清理该流缓存
     *  （full 的 localId 与流的 sdkUuid 不同，hub 无法自行映射）。老 hub 无此 handler，静默忽略 */
    'snapshot-stream-end': (data: {
        sid: string
        /** 流式 snapshot 的 localId（message_start 的 sdkUuid） */
        localId: string
    }) => void
    'session-alive': (data: {
        sid: string
        time: number
        running: boolean
        mode?: 'local' | 'remote'
        permissionMode?: PermissionMode
        model?: string | null
        effort?: EffortLevel
        /** 当前 output style：随 keep-alive 上报，hub 落 runtimeState.outputStyle 供 resume 回放 */
        outputStyle?: string
    }) => void
    'session-end': (data: { sid: string; time: number }) => void
    'update-metadata': (data: { sid: string; expectedVersion: number; metadata: unknown }, cb: (answer: {
        result: 'error'
        reason?: SocketErrorReason
    } | {
        result: 'version-mismatch'
        version: number
        metadata: unknown | null
    } | {
        result: 'success'
        version: number
        metadata: unknown | null
    }) => void) => void
    'update-state': (data: { sid: string; expectedVersion: number; agentState: unknown | null }, cb: (answer: {
        result: 'error'
        reason?: SocketErrorReason
    } | {
        result: 'version-mismatch'
        version: number
        agentState: unknown | null
    } | {
        result: 'success'
        version: number
        agentState: unknown | null
    }) => void) => void
    'machine-alive': (data: { machineId: string; time: number }) => void
    'machine-update-metadata': (data: { machineId: string; expectedVersion: number; metadata: unknown }, cb: (answer: {
        result: 'error'
        reason?: SocketErrorReason
    } | {
        result: 'version-mismatch'
        version: number
        metadata: unknown | null
    } | {
        result: 'success'
        version: number
        metadata: unknown | null
    }) => void) => void
    'machine-update-state': (data: { machineId: string; expectedVersion: number; runnerState: unknown | null }, cb: (answer: {
        result: 'error'
        reason?: SocketErrorReason
    } | {
        result: 'version-mismatch'
        version: number
        runnerState: unknown | null
    } | {
        result: 'success'
        version: number
        runnerState: unknown | null
    }) => void) => void
    'rpc-register': (data: { method: string }) => void
    'rpc-unregister': (data: { method: string }) => void
    'terminal:ready': (data: TerminalReadyPayload) => void
    'terminal:output': (data: TerminalOutputPayload) => void
    'terminal:exit': (data: TerminalExitPayload) => void
    'terminal:error': (data: TerminalErrorPayload) => void
    ping: (callback: () => void) => void
    'usage-report': (data: unknown) => void
    'idle-timeout-warning': (data: { sid: string; timeoutAt: number; remainingMs: number }) => void
    // ===== 消息事实协议 =====
    /** CLI→Hub 统一消息事实事件：批内合并多 kind fact 一次往返（MessageFact 联合见 messages.ts）。
     *  原 4 个独立事件（messages-submitted/bound/native-attached/acked）已下线，语义由各 fact kind 承载 */
    'messages-facts': (data: { sid: string; facts: MessageFact[] }) => void
    /** rewind 截断成功（CLI → Hub）：Hub 即刻按 deleteFromSeq 软删除并转 SSE */
    'rewind-truncated': (data: { sid: string; nativeId: string; deleteFromSeq: number }) => void
    /** rewind 终态（CLI → Hub）：filesRestored false 时 error 携带原因；skippedLinks>0 时部分路径被安全护栏跳过 */
    'rewind-completed': (data: { sid: string; filesRestored: boolean; error?: string; skippedLinks?: number }) => void
    'cancel-queued-message': (data: { sid: string; messageId: string; localId: string }) => void
    /** CLI 事件驱动上报上下文用量（hub 落库到 runtimeState.contextUsage + SSE 推 web）。
     * contextUsage 为 null 表示清空（/clear 后新会话从 0 开始，用量线隐藏直到下次真实 turn） */
    'context-usage': (data: { sid: string; contextUsage: ContextUsage | null }) => void
    /** CLI 事件驱动上报 goal 状态（hub 落库到 runtimeState.goalStatus + SSE 推 web）。
     * goalStatus 为 null 表示清空（达成 10s 后 / 手动清理）。 */
    'goal-status': (data: { sid: string; goalStatus: GoalStatus | null }) => void
    /** CLI 轮次起点上报（running 翻转 false→true 时，hub 落库到 runtimeState.runStartedAt + SSE 推 web）。
     * StatusBar 计时的权威来源——不随 web 消息窗口化丢失（docs/pending.md #55） */
    'run-started': (data: { sid: string; runStartedAt: number }) => void
    /** CLI 会话恢复（resume/fork）时上报 prompt cache 状态（hub 落库到 runtimeState.cacheStatus + SSE 推 web）。
     * cacheStatus 为 null 表示清空（首 turn result 到达后 CLI 清除，过期提示只在首轮前有意义） */
    'cache-status': (data: { sid: string; cacheStatus: CacheStatus | null }) => void
    /** CLI→Hub 的 UI 命令（agent 触达 mobi 界面，A 类）。ack 语义：delivered=true 表示已广播给活跃 Web 连接
     *  （非"用户已看到"，Web 不参与 ack）；无 Web 在线时 delivered=false（调用成功非错误，CLI 转平和反馈）。
     *  socket 断开/ack 超时由 emitWithAck reject 体现，属连接故障，与离线语义区分 */
    'sendUiCommand': (data: { sid: string; action: UiCommandAction }, cb: (answer: UiCommandAck) => void) => void
    /** CLI→Hub 的会话操作（agent 触达其他会话，B 类）。与 A 类的区别：不依赖 Web 在线、
     *  不是瞬态呈现（落库即终态）。namespace 由 Hub 从鉴权过的 sid 解析，CLI 不填。 */
    'listMachinesForAgent': (data: { sid: string }, cb: (answer: AgentMachinesAck) => void) => void
    /** 同上，列出会话供 agent 挑选派活目标。sid 是发问方自己的会话（Hub 据此定 namespace），
     *  其余字段是 agent 的查询条件——namespace 不在入参里，也不可信。 */
    'listSessionsForAgent': (data: AgentSessionsRequest, cb: (answer: AgentSessionsAck) => void) => void
}

/** listSessionsForAgent 入参 */
export type AgentSessionsRequest = {
    sid: string
    /** 匹配标题 / 摘要 / 工作目录（大小写不敏感的子串匹配） */
    keyword?: string
    /** 缺省 ACTIVE */
    status?: AgentSessionStatus
    /** 缺省 20，上限 50（超出按上限截断，不报错） */
    limit?: number
    /** 只看某个项目下的会话 */
    projectId?: string
}
