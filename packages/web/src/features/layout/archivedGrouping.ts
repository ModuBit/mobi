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
 * 归档页分组形态（纯逻辑，供 ArchivedSessionsPage 与单测共用）。
 *
 * antd Listy 的 group 会按 key 对 items 做稳定聚类重排（同键行聚成连续块，
 * 组间按首现位置排序）——直接在全局时间交错序上标组边界，标注会与重排后的
 * 视觉序脱节（alpha 行的前驱后继在原始序里可能是别的组 → 被错标为单行组）。
 * 因此分组必须先在数据层显式完成：本函数输出「组区块连续」的行序列 + 逐行
 * 边界标注，Listy 拿到的序列已同键连续，其聚类重排退化为恒等。
 */

import type { Session } from '@/core/data/api/types'

/** 带组边界标注的行（groupFirst/groupLast 驱动色块卡圆角与 hairline） */
export interface AnnotatedRow {
    session: Session
    groupFirst: boolean
    groupLast: boolean
}

/** 组键：工作区 id；未归入工作区为 null（Listy 侧走 '__none__' 哨兵映射） */
export const archivedGroupKey = (s: Session): string | null => s.workspaceId ?? null

/**
 * 聚类排序 + 组边界标注。
 *
 * 入参约定为 archived_at 倒序的全局序列（daemon 分页序）；组内行保持该序
 * （即组内最新归档在前），组间按各组首行位置排序——首行即该组最新归档，
 * 等价于「最近归档的组在前」。输出序列同键连续，边界标注与其视觉位置一致。
 */
export function groupAndAnnotate(sessions: Session[]): AnnotatedRow[] {
    // Map 保插入序：组按首现位置排列
    const groups = new Map<string | null, Session[]>()
    for (const s of sessions) {
        const key = archivedGroupKey(s)
        const bucket = groups.get(key)
        if (bucket) bucket.push(s)
        else groups.set(key, [s])
    }
    const sorted = [...groups.values()].flat()
    // 首末行用 undefined 哨兵（≠ 任何 null/string 组键）保证边界判定
    return sorted.map((session, i) => {
        const key = archivedGroupKey(session)
        const prevKey = i > 0 ? archivedGroupKey(sorted[i - 1]) : undefined
        const nextKey = i < sorted.length - 1 ? archivedGroupKey(sorted[i + 1]) : undefined
        return { session, groupFirst: prevKey !== key, groupLast: nextKey !== key }
    })
}
