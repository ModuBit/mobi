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

import type { InfiniteData } from '@tanstack/react-query'
import type { ProjectSessionsPage } from '@/core/data/api/types'

/**
 * 置顶乐观更新的缓存调整（纯函数，便于单测）。
 *
 * 背景：置顶点击后走「mutation → invalidate → refetch → SSE 批处理」链路，
 * 大库多会话时整条收敛要 2-3s，用户感知「点了没反应」。改为点击瞬间本地先生效：
 * 分组成员（sessionIds pages）与 pinned 标记立即翻转，成功后的 invalidate 与
 * SSE 事件做真值补偿（顺带同步其他端）。
 */

/**
 * 在无限分页查询的 pages 中加入/移除会话 id（幂等：目标态已满足则原样返回）。
 * add=true：插入首页首位（置顶区新成员排最前）并 total+1；
 * add=false：从所有页移除并 total-1（各页 total 同步，避免「剩余 N」短暂失真）。
 * 缓存尚无数据（查询未拉过）时原样返回，留给 invalidate 补偿填充。
 */
export function toggleIdInPages(
    data: InfiniteData<ProjectSessionsPage> | undefined,
    sessionId: string,
    add: boolean,
): InfiniteData<ProjectSessionsPage> | undefined {
    if (!data) return data

    const existed = data.pages.some(p => p.sessionIds.includes(sessionId))
    if (add === existed) return data

    let pages: ProjectSessionsPage[]
    if (add) {
        pages = data.pages.length === 0
            // 置顶区通常已拉过首页；防御性兜底（查询刚被 reset）
            ? [{ sessionIds: [sessionId], nextCursor: null, hasMore: false, total: 1 }]
            : data.pages.map((p, i) => i === 0
                ? { ...p, sessionIds: [sessionId, ...p.sessionIds], total: p.total + 1 }
                : p)
    } else {
        pages = data.pages.map(p => ({
            ...p,
            sessionIds: p.sessionIds.filter(id => id !== sessionId),
            total: Math.max(p.total - 1, 0),
        }))
    }

    return { ...data, pages }
}
