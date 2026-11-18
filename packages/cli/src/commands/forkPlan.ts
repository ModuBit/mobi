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

/** fork 可解析行：在 ForkableSession 之上收敛出非空 native id（--resume 的目标必须就绪） */
export type ForkResolvableSession = ForkableSession & { nativeSessionId: string }

/** native id 就绪判定：null = Claude 会话尚未回报（fork 无 --resume 目标，无意义） */
export function isForkResolvable(session: ForkableSession): session is ForkResolvableSession {
    return session.nativeSessionId !== null
}

export type ForkPlan =
    | { kind: 'resolved'; session: ForkResolvableSession }
    | { kind: 'ambiguous'; matches: ForkResolvableSession[] }
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

function byRecency<T extends ForkableSession>(sessions: readonly T[]): T[] {
    return [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)
}

function withTitle(session: ForkableSession): string | null {
    return session.title && session.title.length > 0 ? session.title : null
}

/**
 * 候选集 → 决策：单一命中 = resolved，多命中 = ambiguous，空集 = 交给下一优先级。
 * 三段匹配（id 前缀 / 标题精确 / 标题包含）共用同一分类，避免逐段抄同一 if 形状。
 */
function classify(matches: ForkResolvableSession[]): ForkPlan | null {
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
 * native id 未就绪的行在入口先排除——fork 无 --resume 目标无意义，不能当「最近活跃」解析出去。
 */
export function planFork(sessions: readonly ForkableSession[], query?: string): ForkPlan {
    const resolvable = sessions.filter(isForkResolvable)
    if (resolvable.length === 0) return { kind: 'empty' }

    const ordered = byRecency(resolvable)
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

/** 交互选择器里的关键字过滤：标题 / 工作区路径 / mobi id 前缀（泛型保住调用方的窄类型） */
export function filterSessions<T extends ForkableSession>(
    sessions: readonly T[],
    keyword: string
): T[] {
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

/**
 * Claude 子进程 close 事件的失败消息：信号终止（SIGKILL/SIGTERM 等）时 code 为
 * null，只报 code 会退化成「exited with code null」丢掉死因；有 signal 时带信号名。
 */
export function formatClaudeExitError(code: number | null, signal: NodeJS.Signals | null): string {
    return signal ? `Claude terminated by signal ${signal}` : `Claude exited with code ${code}`
}

/** 列表行：序号、标题/短 id、工作区、最近活跃；native id 未就绪的行标注不可接续 */
export function formatSessionLine(session: ForkableSession, index: number): string {
    const label = session.title ?? `(未命名 ${shortSessionId(session.id)})`
    const updated = new Date(session.updatedAt).toLocaleString()
    const online = session.status === 'online' ? ' · 进程在线' : ''
    // 未就绪行只可列示不可 fork（forkPlan.planFork 已将其排除出候选）：标注口径，
    // 让 sessions list 的读者知道这行不能拿去 fork，避免按序号/标题 fork 落空
    const notReady = session.nativeSessionId === null ? ' · 不可接续（Claude 会话未就绪）' : ''
    return `[${index + 1}] ${label}\n    ${session.path}\n    最近活跃 ${updated} · ${shortSessionId(session.id)}${online}${notReady}`
}
