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
 * scope-tabbed 管理页骨架（架构深化候选②）：「（可选）搜索/动作行 + scope tabs +
 * 内容区」的不变结构。skill / mcp / plugin 三张管理页共用（spec 决策 15 的兑现）；
 * 数据（workspaces/列表）与过滤谓词归调用方，骨架零数据依赖、零 mock 可测。
 * 弹窗不进骨架（各域表单字段差异大，scope radio 那一角由 useScopeOptions 根治）。
 *
 * 搜索框与动作槽都可缺省：动作上提到页题行（settingsHeaderSlot）的页面两者全不给，
 * 页签条直接跟在标题下；搜索三件套（值/回调/占位）同给才渲染搜索框。
 *
 * 页签条用自管 TabStrip 族（2026-11-13 起替代 antd Tabs，antd Tabs 全站清零且 eslint 禁新增）：
 * - 动作槽不在 tablist 行内（原 extra 槽方案随「搜索+动作同行」改版退役）——页签条是
 *   纯分段控件，不被动作按钮牵动键盘/焦点链路；
 * - children **不进面板**：与旧 antd 版一致恒渲染在页签条下方，切 scope 只换数据不重挂结构。
 *   页签因此是**纯分段控件**（panelless）：内容不在 tabpanel 里，aria-controls 不渲染，
 *   也不渲染空壳 TabStripPanel 去凑落点（display:none 的死元素不是 a11y 落点）。
 */
import type { CSSProperties, ReactNode } from 'react'
import styled from '@emotion/styled'
import { TabStrip, TabStripList, TabStripTab } from '@/ui/base/interactive/tabStrip'
import { ExpandingSearch } from '@/ui/base/interactive/expanding-search/ExpandingSearch'

export interface ScopeTabbedSectionProps {
    /** 搜索框受控值（caller 持状态并按 keyword 过滤列表；骨架只锁结构不管谓词）。
     *  与 onKeywordChange/searchPlaceholder 三者同给才渲染搜索框——不需要过滤的页面省略 */
    keyword?: string
    onKeywordChange?: (keyword: string) => void
    searchPlaceholder?: string
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

/** 搜索行：搜索框吃满余量 + 动作槽贴行右端（gap 同时作用于框与按钮、按钮与按钮之间） */
const ToolbarRow = styled.div`
    display: flex;
    align-items: center;
    gap: 8px;
`

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
    // 三件套（值/回调/占位）同给才渲染搜索框：省略 = 本页不做关键词过滤
    const searchSlot = keyword !== undefined && onKeywordChange !== undefined && searchPlaceholder !== undefined
        ? (
            <ExpandingSearch
                label={searchPlaceholder}
                placeholder={searchPlaceholder}
                value={keyword}
                onValueChange={onKeywordChange}
                style={{ '--es-h': '28px', flex: 1, minWidth: 0 } as CSSProperties}
            />
        )
        : null
    return (
        <>
            {/* 工具条行：搜索框吃满余量 + 动作槽贴行右端。搜索与动作都缺省时整行不渲染
                （动作已上提到页题行的页面，页签条直接跟标题） */}
            {(searchSlot || actions) && (
                <ToolbarRow>
                    {searchSlot}
                    {actions}
                </ToolbarRow>
            )}
            {/* data-testid 落在包裹层（TabStrip 不收 testid）：E2E 以此为锚点找页签条 */}
            <div data-testid={tabsTestId}>
                <TabStrip value={activeScope} onValueChange={onScopeChange}>
                    <TabStripList ariaLabel={tabsAriaLabel ?? 'tabs'} fill>
                        {options.map(o => (
                            <TabStripTab key={o.value} value={o.value} panelless>{o.label}</TabStripTab>
                        ))}
                    </TabStripList>
                </TabStrip>
            </div>
            {children}
        </>
    )
}
