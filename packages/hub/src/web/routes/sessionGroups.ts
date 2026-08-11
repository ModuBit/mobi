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

import type { SessionSummary } from '@mobi/shared'
import { Hono } from 'hono'
import { z } from 'zod'
import type { StoredSession, Store } from '../../store'
import { extractGroupKey } from '../../store/sessions'
import type { Session, SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'
import { requireSyncEngine } from './guards'

// 构建实时 session 状态映射（用于获取正确的 active 状态）
function buildLiveSessionMap(engine: SyncEngine, namespace: string): Map<string, Session> {
    const liveSessions = engine.getSessionsByNamespace(namespace)
    const map = new Map<string, Session>()
    for (const session of liveSessions) {
        map.set(session.id, session)
    }
    return map
}

// 计算每个分组的活跃会话数量
function computeActiveCountsByGroup(
    engine: SyncEngine,
    namespace: string
): Map<string, number> {
    const liveSessions = engine.getSessionsByNamespace(namespace)
    const counts = new Map<string, number>()

    for (const session of liveSessions) {
        if (session.active) {
            const groupKey = extractGroupKey(session.metadata?.path)
            if (groupKey) {
                counts.set(groupKey, (counts.get(groupKey) ?? 0) + 1)
            }
        }
    }

    return counts
}

// 将 StoredSession 转换为 SessionSummary，使用实时数据获取 active 状态
function toSummary(s: StoredSession, liveSessionMap: Map<string, Session>): SessionSummary {
    // 从实时数据中获取 active 状态（数据库不存储）
    const liveSession = liveSessionMap.get(s.id)
    const active = liveSession?.active ?? false
    const activeAt = liveSession?.activeAt ?? 0
    const running = liveSession?.running ?? false

    const metadata = s.metadata as {
        path?: string
        name?: string
        machineId?: string
        summary?: { text: string }
        flavor?: string | null
        worktree?: { basePath: string; branch: string; name: string }
    } | null

    const agentState = s.agentState as { requests?: Record<string, unknown> } | null
    const runtimeState = s.runtimeState as { todos?: Array<{ status: string }>; tasks?: Array<{ status: string }> } | null

    const pendingRequestsCount = agentState?.requests ? Object.keys(agentState.requests).length : 0

    // metadata 必须包含 path 才能创建 summaryMetadata
    const summaryMetadata = metadata?.path ? {
        name: metadata.name,
        path: metadata.path,
        machineId: metadata.machineId ?? undefined,
        summary: metadata.summary ? { text: metadata.summary.text } : undefined,
        flavor: metadata.flavor ?? null,
        worktree: metadata.worktree
    } : null

    const todoProgress = runtimeState?.todos?.length ? {
        completed: runtimeState.todos.filter(t => t.status === 'completed').length,
        total: runtimeState.todos.length
    } : null

    const taskProgress = runtimeState?.tasks?.length ? {
        completed: runtimeState.tasks.filter(t => t.status === 'completed').length,
        total: runtimeState.tasks.length
    } : null

    return {
        id: s.id,
        active,
        running,
        activeAt,
        updatedAt: s.updatedAt,
        metadata: summaryMetadata,
        todoProgress,
        taskProgress,
        pendingRequestsCount
    }
}

const groupSessionsQuerySchema = z.object({
    groupKey: z.string().min(1),
    limit: z.coerce.number().min(1).max(100).optional().default(20),
    cursor: z.coerce.number().optional()
})

export function createSessionGroupsRoutes(
    getSyncEngine: () => SyncEngine | null,
    store: Store
): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    // GET /api/session-groups - 获取分组列表
    app.get('/session-groups', (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine

        const namespace = c.get('namespace')
        const groups = store.sessions.getSessionGroups(namespace)

        // 从内存计算每个分组的活跃会话数量
        const activeCounts = computeActiveCountsByGroup(engine, namespace)
        const groupsWithActiveCount = groups.map(group => ({
            ...group,
            activeCount: activeCounts.get(group.key) ?? 0
        }))

        return c.json({ groups: groupsWithActiveCount })
    })

    // GET /api/session-groups/sessions - 获取分组内 sessions
    app.get('/session-groups/sessions', (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine

        const query = c.req.query()
        const parsed = groupSessionsQuerySchema.safeParse(query)
        if (!parsed.success) {
            return c.json({ error: 'Invalid query parameters' }, 400)
        }

        const { groupKey, limit, cursor } = parsed.data
        const namespace = c.get('namespace')

        // 构建实时 session 映射，用于获取正确的 active 状态
        const liveSessionMap = buildLiveSessionMap(engine, namespace)

        const result = store.sessions.getSessionsByGroup(
            namespace,
            groupKey,
            cursor ?? null,
            limit
        )

        const sessions = result.sessions.map(s => toSummary(s, liveSessionMap))

        return c.json({
            sessions,
            nextCursor: result.nextCursor,
            hasMore: result.hasMore,
            total: result.total
        })
    })

    return app
}
