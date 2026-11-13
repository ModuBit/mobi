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
 */
import type { ReactNode } from 'react'
import { Tabs } from 'antd'
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
            <Tabs
                activeKey={activeScope}
                onChange={onScopeChange}
                items={options.map(o => ({ key: o.value, label: o.label }))}
                size="small"
                data-testid={tabsTestId}
                tabBarExtraContent={{ right: actions }}
            />
            {children}
        </>
    )
}
