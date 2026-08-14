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

import { useCallback, useMemo, useState } from 'react'

/** 分区列表默认展示条数；每次点「展开更多」递增的数量（与会话列表一致） */
export const SECTION_PAGE_SIZE = 5

/**
 * 侧边栏平级分区的列表前端分页（「项目」分区等：全量数据在手，只做展示截断）
 *
 * 与会话分组的 usePagedSessionList 区分：后者含触底后端 cursor 分页；
 * 本 hook 纯前端——项目实体量级小，hub 一次性返回全量（真分页需求见 docs/pending.md）。
 * 底部链接复用 SessionListFooter（isLoadingMore 恒 false）。
 */
export function usePagedSectionList<T>(items: T[], pageSize: number = SECTION_PAGE_SIZE) {
    const [visibleCount, setVisibleCount] = useState(pageSize)

    const visibleItems = useMemo(
        () => items.slice(0, visibleCount),
        [items, visibleCount],
    )
    const remainingCount = Math.max(items.length - visibleCount, 0)

    const showMore = useCallback(() => {
        setVisibleCount(count => count + pageSize)
    }, [pageSize])

    const collapse = useCallback(() => {
        setVisibleCount(pageSize)
    }, [pageSize])

    return {
        visibleItems,
        /** 已展开且超出首屏，可收起 */
        showCollapse: visibleCount > pageSize,
        /** 还有未展示条目，可展开更多 */
        canShowMore: remainingCount > 0,
        remainingCount,
        showMore,
        collapse,
    }
}
