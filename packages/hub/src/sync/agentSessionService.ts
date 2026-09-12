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
 * Agent 会话操作服务（B 类工具族的编排入口）。
 *
 * 职责：agent 触达其他会话的全部业务规则——列会话、列机器、建会话、
 * 把消息投给别的会话。**方法是这些规则的唯一入口**：socket handler 只做
 * 外层校验、鉴权、调用、把结果转 ack（与 SessionMessageFactsProcessor /
 * SessionForkStore 的既有分工一致）。
 *
 * 与 A 类（UI 命令）的分界：A 类依赖 Web 在线、是瞬态呈现（不落库）；
 * B 类不依赖 Web，落库即终态。
 *
 * 依赖一律收成窄入参（不直接持 Store / MachineCache），便于单测用内存假件。
 */

import { AGENT_SESSIONS_DEFAULT_LIMIT, AGENT_SESSIONS_MAX_LIMIT, normalizeUserContent, UserMessageContentSchema } from '@mobi/shared'
import type {
    AgentCreateSessionAck,
    AgentCreateSessionRequest,
    AgentMachineSummary,
    AgentMessageDelivery,
    AgentSendMessageTargetResult,
    AgentSessionStatus,
    AgentSessionSummary,
} from '@mobi/shared'
import type { Session } from '@mobi/shared/types'
import type { EffortLevel, PermissionMode } from '@mobi/shared'
import { randomUUID } from 'node:crypto'
import { hubLogger } from '../logger'
import type { Machine } from './machineCache'

/** 项目归属校验结论（与 Web 侧 spawn 路由同一规则的取值） */
export type ProjectAssignability = 'ok' | 'not_found' | 'machine_mismatch'

/** 建会话入参（sid 是寻址信息，不属于业务规则，服务不收） */
export type AgentCreateSessionInput = Omit<AgentCreateSessionRequest, 'sid'>

/** 投递入参（sid / namespace 都是寻址信息，服务不收） */
export interface AgentSendMessageInput {
    /** 目标会话 id（非空由 handler 的形状校验保证） */
    targets: string[]
    /** 与 Web composer 同形的内容三形态，此处未校验，由服务按统一词汇表把关 */
    content: unknown
}

export interface AgentSessionServiceDeps {
    /** namespace 内在线的机器；离线机器不出现在结果里（派活目标必须在线） */
    getOnlineMachinesByNamespace: (namespace: string) => Machine[]
    /** namespace 内的全部会话（含未激活）；过滤排序由本服务负责 */
    getSessionsByNamespace: (namespace: string) => Session[]
    /** 按 id 取机器（含离线）。派活前必须确认它**在线**——离线机器起不了会话 */
    getMachineByNamespace: (machineId: string, namespace: string) => Machine | undefined
    /**
     * 按 id 取会话（含未激活）。投递要同时拿到**发送方**的名字/机器（信封与同机器判据）
     * 与**每个目标**的活性——两者都是「按 id 在 namespace 内解析一个会话」，一个依赖够用。
     */
    getSessionByNamespace: (sessionId: string, namespace: string) => Session | undefined
    /** 项目归属校验：与 Web 侧 spawn 路由共用同一实现，两处规则不能各写一份 */
    checkProjectAssignable: (projectId: string, namespace: string, machineId: string) => ProjectAssignability
    /** 起会话进程（既有 spawn 链路：Hub → runner RPC → spawn CLI → 等会话 webhook） */
    spawnSession: (machineId: string, directory: string, options: {
        model?: string
        effort?: EffortLevel
        permissionMode?: PermissionMode
        projectId?: string
    }) => Promise<{ type: 'success'; sessionId: string } | { type: 'error'; message: string }>
    /** 把一条跨会话消息推进目标 CLI 的 input stream（RPC 投递，**不经投递队列**） */
    pushAgentMessage: (sessionId: string, delivery: AgentMessageDelivery) => Promise<void>
    /** 把投递成功的那条消息落到目标会话（落库形态不含信封，meta 带 sentFrom/crossSession/fromSessionId） */
    storeAgentMessage: (sessionId: string, delivery: AgentMessageDelivery) => Promise<void>
}

/** list_sessions 的查询条件（不含 namespace——那是从鉴权会话解析出来的） */
export interface AgentSessionQuery {
    keyword?: string
    status?: AgentSessionStatus
    limit?: number
    projectId?: string
}

/** 机器 → agent 视角摘要。展示名取机器自报的 displayName，缺省回退 host。 */
export function toMachineSummary(machine: Machine): AgentMachineSummary {
    return {
        machineId: machine.id,
        name: machine.metadata?.displayName ?? machine.metadata?.host ?? machine.id,
        hostname: machine.metadata?.host ?? machine.id,
        activeAt: machine.activeAt,
    }
}

export class AgentSessionService {
    constructor(private readonly deps: AgentSessionServiceDeps) {}

    /**
     * 列出可派活的机器。
     * 只返回在线机器——离线机器的会话建不起来，列出来只会让 agent 选中一个注定失败的目标。
     */
    listMachines(namespace: string): AgentMachineSummary[] {
        return this.deps.getOnlineMachinesByNamespace(namespace).map(toMachineSummary)
    }

    /**
     * 列出可派活的会话（也是「有没有这个会话」的查询入口）。
     *
     * 顺序：过滤三档 → 项目 → 关键词 → 排序 → 截断 → 映射。先过滤后排序，
     * 避免对注定被丢掉的行做比较。
     */
    listSessions(namespace: string, query: AgentSessionQuery = {}): AgentSessionSummary[] {
        return this.deps.getSessionsByNamespace(namespace)
            .filter((session) => matchesStatus(session, query.status ?? 'ACTIVE'))
            .filter((session) => query.projectId === undefined || session.projectId === query.projectId)
            .filter((session) => matchesKeyword(session, query.keyword))
            .sort(compareForAgent)
            .slice(0, resolveLimit(query.limit))
            .map(toAgentSessionSummary)
    }

    /**
     * 在某台机器上起一个新会话进程。
     *
     * 三道前置闸按「便宜且确定」到「昂贵」排：机器在线 → 项目归属 → 起进程。
     * 前两道不花钱就能给出确定的失败原因，别让它们藏在 RPC 报错里。
     *
     * 成功即代表**会话已经存在**：既有 spawn 链路会等 runner 的会话 webhook
     * （最多 15s）才返回，所以拿到 sessionId 时行已落、进程已起。
     */
    async createSession(namespace: string, input: AgentCreateSessionInput): Promise<AgentCreateSessionAck> {
        const machine = this.deps.getMachineByNamespace(input.machineId, namespace)
        if (!machine || !machine.active) {
            return {
                ok: false,
                error:
                    `No online machine with id "${input.machineId}". ` +
                    'Call list_machines to get the ids of machines that are reachable right now.',
            }
        }

        if (input.projectId !== undefined) {
            const assignable = this.deps.checkProjectAssignable(input.projectId, namespace, machine.id)
            if (assignable === 'not_found') {
                return { ok: false, error: `No project with id "${input.projectId}".` }
            }
            if (assignable === 'machine_mismatch') {
                return {
                    ok: false,
                    error:
                        `Project "${input.projectId}" belongs to a different machine, ` +
                        `so a session started on ${machine.id} cannot join it.`,
                }
            }
        }

        const result = await this.deps.spawnSession(machine.id, input.directory, {
            model: input.model,
            effort: input.effort,
            permissionMode: input.permissionMode,
            projectId: input.projectId,
        })

        if (result.type === 'error') {
            return { ok: false, error: translateSpawnFailure(result.message) }
        }
        return { ok: true, sessionId: result.sessionId }
    }

    /**
     * 把一条消息投给若干会话。
     *
     * 逐条独立、不做事务回滚：投递一旦推进对方 input stream 就收不回来，回滚是假的。
     * 部分成功就是部分成功，逐条如实报。
     *
     * 顺序是「内容闸 → 逐目标投递 → 成功才落库」：
     * - 内容类失败对**每个目标**都是同一句话，先在扇出外定下来，免得逐轮重算，
     *   也保证同一批里内容判据完全一致
     * - 落库在投递成功之后（D29）——失败不落库，Web 上不该出现一条永远不会被处理的消息
     */
    async sendMessageToSessions(
        namespace: string,
        fromSessionId: string,
        input: AgentSendMessageInput
    ): Promise<AgentSendMessageTargetResult[]> {
        const gate = gateContent(input.content)
        if (!gate.ok) {
            return input.targets.map((sessionId) => ({ sessionId, ok: false, error: gate.error }))
        }

        const sender = this.deps.getSessionByNamespace(fromSessionId, namespace)
        const delivery = {
            blocks: gate.blocks,
            // 未命名的会话降级为空串——与 CC 原生 peer 消息「信封缺 from-name」的降级路径同形，
            // Web 显示「来自 其他会话」。不拿 id 冒充名字：id 由 fromSessionId 承担身份，
            // 而这个名字是给人看的
            fromName: sender?.metadata?.name?.trim() ?? '',
            fromSessionId,
        }

        const results: AgentSendMessageTargetResult[] = []
        for (const sessionId of input.targets) {
            results.push(await this.deliverToSession(namespace, sessionId, delivery))
        }
        return results
    }

    /** 单个目标的一次投递：定位 → 活性闸 → 投递 → 落库 */
    private async deliverToSession(
        namespace: string,
        targetSessionId: string,
        delivery: Omit<AgentMessageDelivery, 'messageId'>
    ): Promise<AgentSendMessageTargetResult> {
        const target = this.deps.getSessionByNamespace(targetSessionId, namespace)
        if (!target) {
            return {
                sessionId: targetSessionId,
                ok: false,
                error:
                    `No session with id "${targetSessionId}". ` +
                    'Call list_sessions to get the ids of sessions that exist.',
            }
        }
        // 未激活 = 进程已退，投过去必然掉进黑洞。必须明确失败——静默成功会让 agent
        // 以为话带到了，而对面永远不会回应（它等的那个回复不会来）
        if (!target.active) {
            return {
                sessionId: targetSessionId,
                ok: false,
                error:
                    `Session "${targetSessionId}" is not running any more, so it cannot receive messages. ` +
                    'Call list_sessions to find one that is still active.',
            }
        }

        // 消息标识在投递**前**就确定：它同时是信封的 message-id 与落库行的 localId，
        // 所以拼信封不必等落库（信封只进推给 CC 的那一份，不进落库的那一份）
        const message: AgentMessageDelivery = { ...delivery, messageId: randomUUID() }

        try {
            await this.deps.pushAgentMessage(targetSessionId, message)
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error)
            return { sessionId: targetSessionId, ok: false, error: translatePushFailure(reason) }
        }

        try {
            await this.deps.storeAgentMessage(targetSessionId, message)
        } catch (error) {
            // 投递已经发生，这一步失败只是「Web 上看不到这条」——对调用方而言这仍是成功
            // （ok 的语义是「已进入对方输入队列」，D27）。报失败会让 agent 重发，那才是真的
            // 双份。失败只应出现在 mobi 自身故障（磁盘/DB），留 error 日志归因
            hubLogger.error(
                `[AgentSessions] 跨会话消息已投递但落库失败 sid=${targetSessionId} messageId=${message.messageId}: ` +
                (error instanceof Error ? error.stack ?? error.message : String(error))
            )
        }
        return { sessionId: targetSessionId, ok: true }
    }
}

/**
 * 内容闸：把 agent 给的 content 判成「可以投递的 blocks」或「一句说明为什么不行」。
 *
 * 用 shared 的 `UserMessageContentSchema` 而不是宽松的归一：归一会把无法识别的 block
 * **静默剔除**（logDroppedBlock），agent 说了「带上这个视频」而视频没了却收到成功，
 * 是比失败更坏的结果。agent 输入是严格契约，先按词汇表 parse 一遍。
 */
function gateContent(content: unknown): { ok: true; blocks: AgentMessageDelivery['blocks'] } | { ok: false; error: string } {
    const parsed = UserMessageContentSchema.safeParse(content)
    if (!parsed.success) {
        return {
            ok: false,
            error:
                'content was not in a shape mobi understands. Pass plain text, or blocks of type ' +
                'text / quote / image / document — the same forms the mobi composer accepts.',
        }
    }

    const blocks = normalizeUserContent(parsed.data)
    if (!blocks) {
        return { ok: false, error: 'content was empty, so there was nothing to send.' }
    }

    // 一颗一票的事：本期只支持 text（富内容在同批次的下一张票）。
    // **整条拒绝**，不剔除该 block 继续发文本——静默降级会让 agent 以为文件带上了
    const unsupported = blocks.find((block) => block.type !== 'text')
    if (unsupported) {
        return {
            ok: false,
            error:
                `This version of mobi can only send text messages, and content contained a "${unsupported.type}" block. ` +
                'Send the text now, and pass the file separately, or ask the user to forward it.',
        }
    }

    return { ok: true, blocks }
}

/**
 * spawn 失败翻译。
 *
 * 只翻译 **RPC 层内部错误**——它们描述的是 mobi 的内部结构（哪个 handler 没注册、
 * 哪个 socket 断了），agent 无从据此行动，还容易把 "RPC handler not registered"
 * 误读成「这个工具坏了」。上游自己产出的失败（目录建不出来 / 进程起来就退出）
 * 本来就是人话，原样透出，不另造一套映射。
 */
function translateSpawnFailure(message: string): string {
    switch (classifyRpcFailure(message)) {
        case 'unreachable':
            return (
                'That machine is not running a mobi runner right now, so no session can be started on it. ' +
                'Call list_machines to see which machines are reachable.'
            )
        case 'timeout':
            // 两种超时共用一句：RPC 30s 未回，与 runner 等会话 webhook 15s 未果。
            // 两种情况下进程都可能已经起来了——所以说「可能已建」，并给出避免建重的方法
            return (
                'The machine did not respond in time. The session may or may not have been created — ' +
                'call list_sessions before retrying, so you do not end up with two.'
            )
        default:
            return message
    }
}

/**
 * 投递失败翻译。
 *
 * 与 spawn 共用同一套 RPC 故障分类（见 classifyRpcFailure），但表述不同：这条失败
 * 落在**目标会话**身上，不在机器上；而且 RPC 超时**不代表没送到**——emitWithAck
 * 超时只是回执没回来，消息可能已经推进对方输入流，所以说「可能已送达」并明确劝阻重发。
 */
function translatePushFailure(message: string): string {
    switch (classifyRpcFailure(message)) {
        case 'unreachable':
            return (
                'That session is not reachable right now — its Claude Code process is gone or its mobi client is not connected, ' +
                'so the message was not delivered.'
            )
        case 'timeout':
            return (
                'That session did not acknowledge the message in time. It may or may not have been delivered — ' +
                'do not send it again blindly; check first whether the session reacted.'
            )
        default:
            return message
    }
}

/**
 * RPC 故障分类（Hub → CLI/machine 两个方向共用）。
 *
 * 三种上游错误各有各的人话，但**分类规则**只有一套：翻译函数各写一份 `includes`
 * 迟早会漂移成两套判据，那时候「同一种故障在 A 工具说人话、在 B 工具漏内部错误」
 * 这种最难查的不一致就出现了。分类归此，措辞归各自的翻译函数。
 */
function classifyRpcFailure(message: string): 'unreachable' | 'timeout' | 'other' {
    if (message.includes('RPC handler not registered') || message.includes('RPC socket disconnected')) {
        return 'unreachable'
    }
    // socket.io 的 ack 超时文案是 "operation has timed out"，runner 侧自带的是
    // "... webhook timeout for PID N"——两处都含 timeout/timed out
    if (/timed?\s*out/i.test(message)) {
        return 'timeout'
    }
    return 'other'
}

function matchesStatus(session: Session, status: AgentSessionStatus): boolean {
    if (status === 'ALL') {
        return true
    }
    return status === 'ACTIVE' ? session.active : !session.active
}

/** 关键词归一：去空白 + 转小写；空串等同没给（否则空关键词会匹配不到任何东西） */
function normalizeKeyword(keyword: string | undefined): string | null {
    const normalized = keyword?.trim().toLowerCase()
    return normalized ? normalized : null
}

function matchesKeyword(session: Session, keyword: string | undefined): boolean {
    const needle = normalizeKeyword(keyword)
    if (needle === null) {
        return true
    }
    return [session.metadata?.name, session.metadata?.summary?.text, session.metadata?.path]
        .some((field) => field?.toLowerCase().includes(needle))
}

/**
 * 排序：active 优先 → 最近活动。
 *
 * 刻意**不含** web 列表（GET /sessions）夹在中间的那一层「待审批数降序」：
 * 那层是给人看的——需要人拍板的会话浮到顶部提醒人去处理。agent 挑派活目标时
 * 「最近动过」才是有效信号，而且它并不打算替人去批那笔审批。
 */
function compareForAgent(a: Session, b: Session): number {
    if (a.active !== b.active) {
        return a.active ? -1 : 1
    }
    return b.updatedAt - a.updatedAt
}

/** 入参上限截断：非法值（NaN / 小数 / 越界）一律归到合法区间，不报错 */
function resolveLimit(limit: number | undefined): number {
    if (limit === undefined || !Number.isFinite(limit)) {
        return AGENT_SESSIONS_DEFAULT_LIMIT
    }
    return Math.min(Math.max(Math.trunc(limit), 1), AGENT_SESSIONS_MAX_LIMIT)
}

/** 会话 → agent 视角摘要。metadata 解析失败时相关字段缺省，不填假值。 */
export function toAgentSessionSummary(session: Session): AgentSessionSummary {
    const summary: AgentSessionSummary = {
        sessionId: session.id,
        projectId: session.projectId ?? null,
        active: session.active,
        running: session.running,
        updatedAt: session.updatedAt,
        // wire 上 pinned 是可选的；缺省即未置顶（与落库默认值一致，不是编出来的值）
        pinned: session.pinned ?? false,
    }

    const metadata = session.metadata
    if (metadata) {
        summary.name = metadata.name
        summary.summary = metadata.summary?.text
        summary.machineId = metadata.machineId
        summary.path = metadata.path
    }

    const model = session.runtimeState?.model
    if (model) {
        summary.model = model
    }

    return summary
}
