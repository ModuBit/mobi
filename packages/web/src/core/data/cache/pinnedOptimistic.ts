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
 * 置顶成功后的本地缓存调整（纯函数，便于单测）。
 *
 * 背景：置顶若只靠「invalidate → refetch → SSE 批处理」链路收敛，
 * 大库多会话时要 2-3s，用户感知「点了没反应」。改为 PATCH success 后
 * 本地缓存立即生效：分组成员（sessionIds pages）与 pinned 标记当场翻转，
 * 随后的 invalidate 与 SSE 事件做真值补偿（顺带同步其他端）。
 */

/**
 * 在无限分页查询的 pages 中加入/移除会话 id（幂等：目标态已满足则原样返回）。
 * add=true：插入首页首位（置顶区新成员排最前），全页 total 同步 +1；
 * add=false：从所有页移除，全页 total 同步 -1（total 是分组全局数、各页一致，
 * 消费方读最后一页，不同步会让「还剩 N」短暂失真）。
 * 缓存无数据（查询未拉过）或 pages 为空（查询刚 reset）时原样返回，
 * 留给 invalidate 补偿填充——不捏造与真值无关的假页。
 */
export function toggleIdInPages(
    data: InfiniteData<ProjectSessionsPage> | undefined,
    sessionId: string,
    add: boolean,
): InfiniteData<ProjectSessionsPage> | undefined {
    if (!data) return data

    const existed = data.pages.some(p => p.sessionIds.includes(sessionId))
    if (add === existed) return data
    // 无页可插/可移（查询刚 reset）：原样返回，不造假页
    if (data.pages.length === 0) return data

    let pages: ProjectSessionsPage[]
    if (add) {
        pages = data.pages.map((p, i) => i === 0
            ? { ...p, sessionIds: [sessionId, ...p.sessionIds], total: p.total + 1 }
            // 非首页 sessionIds 不动，仅 total 同步（分组全局数，与 remove 分支对称，
            // 消费方读最后一页 total，只加首页会让「还剩 N」失真）
            : { ...p, total: p.total + 1 })
    } else {
        pages = data.pages.map(p => ({
            ...p,
            sessionIds: p.sessionIds.filter(id => id !== sessionId),
            total: Math.max(p.total - 1, 0),
        }))
    }

    return { ...data, pages }
}
