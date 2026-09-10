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

import type { AgentStatus } from '@/components/pixel-avatar/types'
import { statusColorOf } from '@/components/tool-card/toolIcons'
import type { PixelVariant } from '@/components/ui/PixelLoader'
import type { Session } from '@/core/data/api/types'
import { stableHash } from '@/core/utils/hash'

/**
 * getSessionAvatarStatus 的最小输入结构。
 * 列表项（SessionSummary）只带 pendingRequestsCount，详情项（Session）带 agentState.requests，
 * 两者结构不同但都能判断状态，故取交集声明为可选，兼容两类调用方。
 */
type AvatarStatusInput = Pick<Session, 'id' | 'active' | 'running'> & {
    agentState?: { requests?: Record<string, unknown> | null } | null
    pendingRequestsCount?: number
}

/**
 * 根据会话状态映射为头像状态
 * 多处复用：SidebarProjects、MobileProjectList
 *
 * 待审批判定双数据源：
 *   - 列表项（SessionSummary）：只有 pendingRequestsCount（hub 序列化时已计数）
 *   - 详情项（Session）：只有 agentState.requests
 * 任一来源 > 0 即视为待审批，否则列表里 pendingRequestsCount 缺失会导致待审批会话
 * 仍显示运行中蓝色（useSessions 把 SessionSummary as Session[]，agentState 恒空）。
 */
export function getSessionAvatarStatus(session: AvatarStatusInput): AgentStatus {
    if (!session.active) return 'inactive'
    const pendingFromSummary = session.pendingRequestsCount ?? 0
    const pendingFromDetail = session.agentState?.requests ? Object.keys(session.agentState.requests).length : 0
    if (pendingFromSummary > 0 || pendingFromDetail > 0) return 'awaiting_auth'
    if (session.running) return 'outputting'
    return 'idle'
}

/** 会话状态 → 列表状态指示（PixelLoader 波形）的配置；phase 供 twinkle/ghost 相位轮转 */
export type SessionLoader = {
    variant: PixelVariant
    /** 语义例外色（审批橙）；缺省继承环境文字色 */
    color?: string
    /** 相位（秒，[0,5)）：twinkle 行间错相 + twinkle/ghost 树轮转种子，从会话 id 派生 */
    phase?: number
}

/** 会话 id → 稳定伪随机相位（0~5s）：同 id 恒同相，不同 id 错开，避免多行 twinkle 锁步齐闪 */
function idPhase(id: string): number {
    return (stableHash(id) % 997) / 997 * 5
}

/**
 * 会话列表状态指示的波形映射（与 getSessionAvatarStatus 同源判定）：
 * - 运行中 → drive（波前推进，「正在干活」）
 * - 待审批 → orbit 染橙（绕圈等你给回合；橙 = 需要行动的语义例外，列表最高注意力）
 * - 空闲   → twinkle（星空低频眨眼，「活着但闲置」；相位按行错开）
 * - 其余   → ghost（静止暗格，「在场但已关闭」）
 */
export function getSessionLoader(session: AvatarStatusInput): SessionLoader {
    switch (getSessionAvatarStatus(session)) {
        case 'outputting': return { variant: 'drive' }
        // 审批橙走统一取色口（去色语义单点），不直读色板
        case 'awaiting_auth': return { variant: 'orbit', color: statusColorOf('awaiting_auth') }
        case 'idle': return { variant: 'twinkle', phase: idPhase(session.id) }
        // ghost 的 6 格随机位置/不透明度同样由 phase 轮转，未激活行彼此不重样
        default: return { variant: 'ghost', phase: idPhase(session.id) }
    }
}

/**
 * 会话列表排序输入：只需 active（活跃二分）与 updatedAt（同组内时间倒序）。
 * 取最小交集，列表摘要态 / 详情态皆可传入。
 */
type SessionSortInput = Pick<Session, 'active' | 'updatedAt'>

/**
 * 会话列表排序比较函数（返回负数 a 在前、正数 b 在前、0 相等）。
 * 复用于：SidebarProjects、MobileProjectList。
 *
 * 排序规则：
 *   1. 活跃会话（active=true，含执行中/等待输入/等待审批）永远排在已退出会话（active=false）之前
 *   2. 同 active 组内按 updatedAt 倒序（最近更新在前）
 *
 * 不变性：只要 a 活跃而 b 不活跃，无论 updatedAt 如何，a 必排在 b 前。
 * 这保证「退出的会话永远不会压在活跃会话之上」——刚退出的会话即便 updatedAt 较新，
 * 也不能盖住仍在执行/等待输入/等待审批的会话。
 */
export function compareSessionsForList(a: SessionSortInput, b: SessionSortInput): number {
    if (a.active !== b.active) return a.active ? -1 : 1
    return b.updatedAt - a.updatedAt
}
