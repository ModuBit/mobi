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
 * scope-tabbed 管理页骨架（架构深化候选②）：「scope tabs + 内容区」的不变结构。
 * 数据（workspaces/列表）与过滤谓词归调用方，骨架零数据依赖、零 mock 可测。
 * 弹窗不进骨架（各域表单字段差异大，scope radio 那一角由 useScopeOptions 根治）。
 *
 * 只保留页签条与内容区：搜索框与动作槽已随「搜索移除 + 动作上提页题行
 * （settingsHeaderSlot）」下线——两个槽在生产无消费方（唯一调用方技能页两者全不给），
 * 留着只是永不触达的分支（架构审查 W4，删除测试：删掉不丢任何行为）。
 *
 * 页签条用自管 TabStrip 族（2026-11-13 起替代 antd Tabs，antd Tabs 全站清零且 eslint 禁新增）：
 * - children **不进面板**：恒渲染在页签条下方，切 scope 只换数据不重挂结构。
 *   页签因此是**纯分段控件**（panelless）：内容不在 tabpanel 里，aria-controls 不渲染，
 *   也不渲染空壳 TabStripPanel 去凑落点（display:none 的死元素不是 a11y 落点）。
 */
import type { ReactNode } from 'react'
import { TabStrip, TabStripList, TabStripTab } from '@/ui/base/interactive/tabStrip'

export interface ScopeTabbedSectionProps {
    /** tabs（含「全局 + workspaces」；由 useScopeOptions 构建） */
    options: { value: string; label: string }[]
    activeScope: string
    onScopeChange: (scope: string) => void
    /** tablist 的无障碍名称（读屏进入页签条时朗读，如「技能作用域」）；缺省退化为通用名 */
    tabsAriaLabel?: string
    /** 内容区（主列表/空态/分组/loading 形态各域不同，children 决定） */
    children: ReactNode
    /** tabs 容器测试锚点（如 skills-tabs） */
    tabsTestId?: string
}

export function ScopeTabbedSection({
    options,
    activeScope,
    onScopeChange,
    tabsAriaLabel,
    children,
    tabsTestId,
}: ScopeTabbedSectionProps) {
    return (
        <>
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
