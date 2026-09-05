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

import { isObject } from './utils'

type RoleWrappedRecord = {
    role: string
    content: unknown
    meta?: unknown
}

// Claude 系统消息中可见的子类型
const VISIBLE_CLAUDE_SYSTEM_SUBTYPES = new Set([
    'api_error',
    'api_retry',
    'turn_duration',
    'microcompact_boundary',
    'compact_boundary',
    'task_progress',
    'task_notification',
    'task_started',
    'task_updated',
])

// 顶层不可见的控制帧（非对话内容，聊天中不渲染）
// - command_lifecycle：SDK 0.3.206 的排队生命周期回执，早期版本曾被当 persistent 落库；
//   新消息已由 classifyMessage discard 拦截，此处兜底静默过滤历史 DB 行（web 端不再 console.warn）
const INVISIBLE_CLAUDE_TOP_LEVEL_TYPES = new Set(['command_lifecycle'])

export function isRoleWrappedRecord(value: unknown): value is RoleWrappedRecord {
    if (!isObject(value)) return false
    return typeof value.role === 'string' && 'content' in value
}

export function unwrapRoleWrappedRecordEnvelope(value: unknown): RoleWrappedRecord | null {
    if (isRoleWrappedRecord(value)) return value
    if (!isObject(value)) return null

    const direct = value.message
    if (isRoleWrappedRecord(direct)) return direct

    const data = value.data
    if (isObject(data) && isRoleWrappedRecord(data.message)) return data.message as RoleWrappedRecord

    const payload = value.payload
    if (isObject(payload) && isRoleWrappedRecord(payload.message)) return payload.message as RoleWrappedRecord

    return null
}

/** unwrapOutputMessage 的产物 */
export interface UnwrappedOutputMessage {
    /** envelope 外层 role（'agent'/'user' 等，是否过滤由调用方按需决定） */
    role: string
    /** SDK 消息数据层：type、message 及 tool_use_result 等同级字段都在这层 */
    data: Record<string, unknown>
    /** Anthropic 消息体；system 消息（task_started 等）无 message 字段时为 null */
    message: Record<string, unknown> | null
    /** message.content 内容块数组；message 缺失或 content 非数组时为 null */
    blocks: unknown[] | null
}

/**
 * 解包 SDK 输出消息的通用骨架：
 * envelope → { role, content } → content.type === 'output' → data。
 * 此前这段解包在 hub sync/tasks.ts 与 sync/teams.ts 三处手写且 role 校验已分叉，
 * 收口于此——envelope 格式变化只改这一处，不会再有静默丢 delta 的漏改点。
 *
 * - 不做 role 过滤：实测 envelope role 随真实消息类型变化（assistant 消息 'agent'、
 *   user 消息 'user'），各调用方按需用返回的 role 自行校验；真正的消息类型判别
 *   一律看 data.type（assistant/user/system）。
 * - message/blocks 可为 null：system 消息没有 message 字段（只带 subtype 等数据层
 *   字段），需要 blocks 的调用方（assistant tool_use / user tool_result）自行判空。
 */
export function unwrapOutputMessage(messageContent: unknown): UnwrappedOutputMessage | null {
    const record = unwrapRoleWrappedRecordEnvelope(messageContent)
    if (!record) return null

    const content = record.content
    if (!isObject(content) || content.type !== 'output') return null

    const data = isObject(content.data) ? content.data : null
    if (!data) return null

    const message = isObject(data.message) ? data.message : null
    const blocks = message && Array.isArray(message.content) ? message.content : null

    return { role: record.role, data, message, blocks }
}

/**
 * 判断 Claude 系统消息子类型是否在聊天中可见
 */
export function isClaudeChatVisibleSystemSubtype(subtype: unknown): subtype is string {
    return typeof subtype === 'string' && VISIBLE_CLAUDE_SYSTEM_SUBTYPES.has(subtype)
}

/**
 * 判断消息是否在 Claude 聊天中可见
 *
 * - 顶层控制帧黑名单（INVISIBLE_CLAUDE_TOP_LEVEL_TYPES）：明确已知的非对话控制帧，静默跳过。
 * - 其余非 system 的顶层 type 一律视为可见（由 normalize handler 决定如何渲染，未识别类型在
 *   normalizeAgentRecord console.warn 后跳过，不走 JSON dump）。
 * 历史上曾为 tool_progress/tool_use_summary 设过顶层黑名单，接入 handler 后已移除——
 * 回滚入口是 git history，无需常驻空集合。
 */
export function isClaudeChatVisibleMessage(message: { type: unknown; subtype?: unknown }): boolean {
    if (message.type !== 'system') {
        return typeof message.type === 'string' && !INVISIBLE_CLAUDE_TOP_LEVEL_TYPES.has(message.type)
    }

    return isClaudeChatVisibleSystemSubtype(message.subtype)
}

export type { RoleWrappedRecord }

/**
 * 消息来源标识（meta.sentFrom）。
 *
 * 开放联合：已知来源（'cli' / 'webapp'）有补全，未来端可按字符串扩展，
 * `(string & {})` 让任意新值仍可赋值而不必先改这里。
 */
export type SentFrom = 'cli' | 'webapp' | (string & {})

/**
 * 用户消息生命周期状态（messages.lifecycle 列 / DecryptedMessage.lifecycle）。
 * - `null`：非排队轨道（agent/CLI/system 输出等），从不进入排队悬浮条
 * - `'queued'`：webapp 用户提交、等待 CLI 消费（悬浮展示）
 * - `'pushed'`：CLI 已 push 给 Claude Code（原 queue_state='consumed'）
 * - `'acked'`：CC isReplay 回显确认收到（原 metadata.nativeAckAt）
 * - `'processing'`：CC 开始处理本条（command_lifecycle:started，P2 写入）
 * - `'done'` / `'cancelled'` / `'discarded'`：CC 终态——完成 / turn 死亡连坐 / 被显式丢弃（P2 写入）
 * - `'refused'`：跨会话 peer 消息被接收侧策略拒收（command_lifecycle:refused，U-8）
 * - `'withdrawn'`：撤回
 * 转换单调前进：只会 queued→pushed→acked→processing→{done|cancelled|discarded|refused}，queued→withdrawn
 */
export type MessageLifecycle = 'queued' | 'pushed' | 'acked' | 'processing' | 'done' | 'cancelled' | 'discarded' | 'refused' | 'withdrawn'

/** lifecycle 状态推进序——与 hub advanceMessagesLifecycle 的 SQL CASE rank 同语义，勿单边改。
 *  终态（done/cancelled/discarded/refused）同为 4：互不覆盖（first-terminal-wins）。withdrawn 单独高位（永不后续推进）。 */
export const LIFECYCLE_RANK: Record<Exclude<MessageLifecycle, null>, number> = {
    queued: 0, pushed: 1, acked: 2, processing: 3, done: 4, cancelled: 4, discarded: 4, refused: 4, withdrawn: 5,
}

/**
 * command_lifecycle 帧可驱动的 lifecycle 状态（单一来源）——MessageLifecycle 的命令轨道子集：
 * started→processing、completed→done、cancelled/discarded/refused 直传（CLI commandLifecycleToFact 转译）。
 * 与 MessageLifecycle/LIFECYCLE_RANK 的对应：排除 queued/pushed/acked（hub 自身推进，不经
 * command_lifecycle 帧）与 withdrawn（撤回留档，仅 hub 内部写入）；本集合全部落在 rank 3/4 档。
 * satisfies 保证不越出 MessageLifecycle 值域（消费端勿手写字面量联合副本，新增状态只改这里）。
 */
export const COMMAND_LIFECYCLE_STATES = ['processing', 'done', 'cancelled', 'discarded', 'refused'] as const satisfies readonly MessageLifecycle[]

export type CommandLifecycleState = (typeof COMMAND_LIFECYCLE_STATES)[number]

/** candidate 是否比 current 更靠后（rank 严格更大且不同 rank——同 rank 的不同终态互不覆盖）。
 *  null（非排队轨道）不参与推进。 */
export function isLifecycleAhead(current: MessageLifecycle | null | undefined, candidate: MessageLifecycle | null | undefined): boolean {
    if (!current || !candidate) return false
    if (current === candidate) return false
    if (LIFECYCLE_RANK[current] === LIFECYCLE_RANK[candidate]) return false
    return LIFECYCLE_RANK[current] < LIFECYCLE_RANK[candidate]
}

/**
 * 停止动作三档（批次 A：停止 × 队列语义闭环）。
 * - 'turn'：只中断当前 turn（web 点按停止；队列照跑、后台任务存活）
 * - 'turn-queue'：中断当前 turn + 清空两层队列（hub queued 物理删除 + CC 层 cancel_queued）
 * - 'turn-queue-tasks'：再终止全部运行中的后台任务（遍历 stopTask）
 */
/** StopKind 的运行时取值（单一来源）：hub abort 路由的 z.enum 直接引用，
 *  勿在消费端手写字符串数组副本（新增档位只改这里） */
export const STOP_KIND_VALUES = ['turn', 'turn-queue', 'turn-queue-tasks'] as const

export type StopKind = (typeof STOP_KIND_VALUES)[number]

export const DEFAULT_STOP_KIND: StopKind = 'turn'

/** 该档位是否需要随 interrupt 发送 cancel_queued（清 CC 层队列） */
export function isCancelQueued(kind: StopKind): boolean {
    return kind !== 'turn'
}

/** 该档位是否需要遍历停止运行中的后台任务 */
export function shouldStopTasks(kind: StopKind): boolean {
    return kind === 'turn-queue-tasks'
}

/** terminal_reason 的 aborted_* 取值（SDK result 的中断死亡回执已知集合，单一来源） */
export const ABORTED_TERMINAL_REASONS = ['aborted_streaming', 'aborted_tools'] as const

/**
 * 是否为「被 interrupt/abort 截断的终态」reason（SDK result.terminal_reason 命中 aborted_*）。
 * 跨端单源：CLI（撤回后中断 result 的转发抑制 / 中断时跳过 usage 上报）与
 * web（aborted 灰行推导）共用——禁止消费端手写 `===` 副本（新增取值只改这里）。
 */
export function isAbortedTerminalReason(reason: unknown): boolean {
    return typeof reason === 'string' && (ABORTED_TERMINAL_REASONS as readonly string[]).includes(reason)
}

/**
 * CLI→Hub 的消息事实（messages-facts 事件载荷元素）。批内合并，一次往返。
 * `at` 为 CLI 观测时刻，缺省由 Hub 取接收时刻。
 * kind 语义：pushed=排队消息已推给 SDK、bound=native 锚点绑定、attached=native session 补写、
 * acked=CC isReplay 回显确认、lifecycle=command_lifecycle 帧转译、withdrawn=撤回（#53）。
 */
export type MessageFact =
    | { kind: 'bound'; localId: string; nativeId: string; nativeSessionId?: string }
    | { kind: 'attached'; nativeSessionId: string }
    | { kind: 'pushed'; localIds: string[]; at?: number }
    | { kind: 'acked'; nativeId: string; at?: number }
    | { kind: 'lifecycle'; nativeId: string; state: CommandLifecycleState; terminalReason?: string; at?: number }
    | { kind: 'withdrawn'; nativeId: string; at?: number }

/** 从消息 content 信封读取 sentFrom 来源标识 */
export function getSentFrom(content: unknown): SentFrom | null {
    if (!isObject(content)) return null
    const meta = (content as { meta?: { sentFrom?: unknown } }).meta
    const sf = meta?.sentFrom
    return typeof sf === 'string' ? sf as SentFrom : null
}

/** 跨会话入站消息标记（user 消息 meta.crossSession，CLI 经 UserPromptSubmit hook 观测写入） */
export interface CrossSessionOrigin {
    /** 发送方 CLI 会话名（如 'mobi-ad'），CLI 层名字，不映射 hub 会话标题 */
    from: string
}

/** 是否为 CLI 来源（Claude Code 输出流回显，永不排队） */
export function isCliOrigin(content: unknown): boolean {
    return getSentFrom(content) === 'cli'
}

/**
 * 是否为「可进入排队轨道的用户提交消息」。
 *
 * 语义（denylist）：**只有 CLI 来源一定不排队**——CLI 消息是 Claude Code 输出流的
 * 回显（local-command-stdout、compact continuation summary 等），已在对话里，不是
 * 待消费的用户输入。其余所有来源（webapp 及未来端）默认排队。
 *
 * 这是「排队」的**唯一写入决策点**：Hub `addMessage` 据此决定 lifecycle。
 * Web 端只读 lifecycle，不再反推来源。
 */
export function isQueueableUserSubmission(content: unknown, localId: string | null | undefined): boolean {
    if (!localId) return false
    if (!isRoleWrappedRecord(content)) return false
    if (content.role !== 'user') return false
    return !isCliOrigin(content)
}
