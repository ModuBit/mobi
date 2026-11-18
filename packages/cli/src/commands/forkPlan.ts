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
 * `mobi fork` 的纯决策逻辑（tui-fork 票 01/02）。
 *
 * 与命令编排分离的原因：会话查询依赖 bun:sqlite，而 CLI 单测跑在 vitest/node 下；
 * 选择规则与 spawn 参数必须能在不碰数据库、不真正 spawn 的前提下被锁定。
 */

import type { ForkableSession } from '@mobi/shared'

export type ForkPlan =
    | { kind: 'resolved'; session: ForkableSession }
    | { kind: 'ambiguous'; matches: ForkableSession[] }
    | { kind: 'empty' }
    | { kind: 'not-found'; query: string; nativeIdLike: boolean }

/** 短 id 长度（git 短 hash 心智）：列表展示与精确匹配共用 */
export const SHORT_ID_LENGTH = 8

/** 短 id 前缀匹配的最短长度：低于 4 位几乎必然多命中 */
const MIN_ID_PREFIX_LENGTH = 4

/** 与 Claude 原生 session id 同形的 UUID；仅用于未命中时给出方向性提示 */
const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function shortSessionId(id: string): string {
    return id.slice(0, SHORT_ID_LENGTH)
}

function byRecency(sessions: readonly ForkableSession[]): ForkableSession[] {
    return [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)
}

function withTitle(session: ForkableSession): string | null {
    return session.title && session.title.length > 0 ? session.title : null
}

/**
 * 候选集 → 决策：单一命中 = resolved，多命中 = ambiguous，空集 = 交给下一优先级。
 * 三段匹配（id 前缀 / 标题精确 / 标题包含）共用同一分类，避免逐段抄同一 if 形状。
 */
function classify(matches: ForkableSession[]): ForkPlan | null {
    if (matches.length === 1) return { kind: 'resolved', session: matches[0] }
    if (matches.length > 1) return { kind: 'ambiguous', matches }
    return null
}

/**
 * 选择要 fork 的会话（匹配优先级从确定到宽松）：
 * 1. mobi session id 完整匹配
 * 2. mobi session id 前缀（≥4 位）
 * 3. 标题完全一致
 * 4. 标题包含
 * 多命中返回 ambiguous，由命令层交给用户选择；不给 query 时取最近活跃。
 */
export function planFork(sessions: readonly ForkableSession[], query?: string): ForkPlan {
    if (sessions.length === 0) return { kind: 'empty' }

    const ordered = byRecency(sessions)
    const trimmed = query?.trim()
    if (!trimmed) {
        return { kind: 'resolved', session: ordered[0] }
    }

    const exactId = ordered.find(session => session.id === trimmed)
    if (exactId) return { kind: 'resolved', session: exactId }

    const lowered = trimmed.toLowerCase()
    if (trimmed.length >= MIN_ID_PREFIX_LENGTH) {
        const prefixPlan = classify(
            ordered.filter(session => session.id.toLowerCase().startsWith(lowered))
        )
        if (prefixPlan) return prefixPlan
    }

    const exactTitlePlan = classify(
        ordered.filter(session => withTitle(session)?.toLowerCase() === lowered)
    )
    if (exactTitlePlan) return exactTitlePlan

    const fuzzyPlan = classify(
        ordered.filter(session => withTitle(session)?.toLowerCase().includes(lowered))
    )
    if (fuzzyPlan) return fuzzyPlan

    return { kind: 'not-found', query: trimmed, nativeIdLike: UUID_LIKE.test(trimmed) }
}

/** 交互选择器里的关键字过滤：标题 / 工作区路径 / mobi id 前缀 */
export function filterSessions(
    sessions: readonly ForkableSession[],
    keyword: string
): ForkableSession[] {
    const lowered = keyword.trim().toLowerCase()
    if (!lowered) return [...sessions]
    return sessions.filter(
        session =>
            withTitle(session)?.toLowerCase().includes(lowered) === true ||
            session.path.toLowerCase().includes(lowered) ||
            session.id.toLowerCase().startsWith(lowered)
    )
}

/** fork 的 Claude 启动参数：续接原上下文并生成新 session id，不带任何 mobi 注入 */
export function buildForkSpawnArgs(nativeSessionId: string): string[] {
    return ['--resume', nativeSessionId, '--fork-session']
}

/** 列表行：序号、标题/短 id、工作区、最近活跃 */
export function formatSessionLine(session: ForkableSession, index: number): string {
    const label = session.title ?? `(未命名 ${shortSessionId(session.id)})`
    const updated = new Date(session.updatedAt).toLocaleString()
    const online = session.status === 'online' ? ' · 进程在线' : ''
    return `[${index + 1}] ${label}\n    ${session.path}\n    最近活跃 ${updated} · ${shortSessionId(session.id)}${online}`
}
