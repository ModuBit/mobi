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
 * scope-tabbed 管理页骨架（架构深化候选②）：「搜索框 + scope tabs + 右上动作槽 +
 * 内容区」的不变结构。skill / mcp / plugin 三张管理页共用（spec 决策 15 的兑现）；
 * 数据（workspaces/列表）与过滤谓词归调用方，骨架零数据依赖、零 mock 可测。
 * 弹窗不进骨架（各域表单字段差异大，scope radio 那一角由 useScopeOptions 根治）。
 *
 * 页签条用自管 TabStrip 族（2026-11-13 起替代 antd Tabs，antd Tabs 全站清零且 eslint 禁新增）：
 * - 右上动作槽走 TabStripList 的 `extra` 槽——它位于 tablist **之外**，不会被页签的键盘/焦点链路牵动；
 * - children **不进面板**：与旧 antd 版一致恒渲染在页签条下方，切 scope 只换数据不重挂结构；
 *   各 value 仍渲染空壳 TabStripPanel，让每个页签的 aria-controls 都有落点（tabStrip 契约）。
 */
import type { ReactNode } from 'react'
import { TabStrip, TabStripList, TabStripPanel, TabStripTab } from '@/ui/base/interactive/tabStrip'
import { SearchField } from '@/ui/base/interactive/search-field/SearchField'

export interface ScopeTabbedSectionProps {
    /** 搜索框受控值（caller 持状态并按 keyword 过滤列表；骨架只锁结构不管谓词） */
    keyword: string
    onKeywordChange: (keyword: string) => void
    searchPlaceholder: string
    /** tabs（含「全局 + workspaces」；由 useScopeOptions 构建） */
    options: { value: string; label: string }[]
    activeScope: string
    onScopeChange: (scope: string) => void
    /** tabs 右上动作槽（安装/新建等域特有入口） */
    actions?: ReactNode
    /** tablist 的无障碍名称（读屏进入页签条时朗读，如「技能作用域」）；缺省退化为通用名 */
    tabsAriaLabel?: string
    /** 内容区（主列表/空态/分组/loading 形态各域不同，children 决定） */
    children: ReactNode
    /** tabs 容器测试锚点（如 skills-tabs） */
    tabsTestId?: string
}

export function ScopeTabbedSection({
    keyword,
    onKeywordChange,
    searchPlaceholder,
    options,
    activeScope,
    onScopeChange,
    actions,
    tabsAriaLabel,
    children,
    tabsTestId,
}: ScopeTabbedSectionProps) {
    return (
        <>
            <SearchField
                value={keyword}
                onValueChange={onKeywordChange}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
            />
            {/* data-testid 落在包裹层（TabStrip 不收 testid）：E2E 以此为锚点找页签条 */}
            <div data-testid={tabsTestId}>
                <TabStrip value={activeScope} onValueChange={onScopeChange}>
                    {/* fill：外壳吃满行内余量，extra 槽（动作钮）照常推到行右端——旧 antd
                        tabBarExtraContent={{ right }} 的布局由它收口 */}
                    <TabStripList ariaLabel={tabsAriaLabel ?? 'tabs'} extra={actions} fill>
                        {options.map(o => (
                            <TabStripTab key={o.value} value={o.value}>{o.label}</TabStripTab>
                        ))}
                    </TabStripList>
                    {/* 空壳面板：仅承接各页签的 aria-controls（内容恒在页签条下方，见头注释） */}
                    {options.map(o => (
                        <TabStripPanel key={o.value} value={o.value}>{null}</TabStripPanel>
                    ))}
                </TabStrip>
            </div>
            {children}
        </>
    )
}
