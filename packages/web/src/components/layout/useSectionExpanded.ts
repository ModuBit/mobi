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

import { useCallback, useState } from 'react'

/**
 * 侧边栏平级分区（项目 / 最近 / 将来的置顶）的折叠状态
 *
 * 与 usePagedSessionList 的 expandWithContent 同语义，供不承载会话分页的分区使用：
 * - 有内容默认展开、空分区默认收起（数据异步到达后自动展开）
 * - 用户 toggle 后以用户选择为准，不再随内容变化翻转
 */
export function useSectionExpanded(hasContent: boolean) {
    const [override, setOverride] = useState<boolean | null>(null)

    const toggleExpanded = useCallback(() => {
        setOverride(!(override ?? hasContent))
    }, [override, hasContent])

    return {
        expanded: override ?? hasContent,
        toggleExpanded,
    }
}
