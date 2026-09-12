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

import { AGENT_SESSIONS_DEFAULT_LIMIT, AGENT_SESSIONS_MAX_LIMIT } from '@mobi/shared'
import type { AgentMachineSummary, AgentSessionStatus, AgentSessionSummary } from '@mobi/shared'
import type { Session } from '@mobi/shared/types'
import type { Machine } from './machineCache'

export interface AgentSessionServiceDeps {
    /** namespace 内在线的机器；离线机器不出现在结果里（派活目标必须在线） */
    getOnlineMachinesByNamespace: (namespace: string) => Machine[]
    /** namespace 内的全部会话（含未激活）；过滤排序由本服务负责 */
    getSessionsByNamespace: (namespace: string) => Session[]
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
