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

import type React from 'react'
import { memo } from 'react'
import { theme as antTheme } from 'antd'
import { TURN_DIFF_EVENT, type ContentBlock, type UserCustomEventBlock } from '@mobi/shared'
import type { CustomBlock as CustomBlockType } from '@/domain/chat'
import { useWorkspaceStore } from '@/core/data/stores/workspaceStore'
import { Markdown } from '@/components/ui/Markdown'
import { TurnDiffCard } from './TurnDiffCard'

/**
 * 自定义消息渲染器（ADR 0002）：按 block.type 一级分发。
 * - text 段经 Markdown 渲染——内部动作（如 fork 溯源跳转）是文本中的 mobi:// 动作
 *   链接（ADR 0003），由 Markdown 链接拦截层统一分发，本组件无二级注册表
 * - custom-event 按事件 name 二级路由（受控注册表，shared TURN_DIFF_EVENT 单源锁名）；
 *   未注册的事件跳过不渲染
 * - 未注册的 block 类型跳过不渲染（向前兼容，未来在此注册新渲染器）
 */

/** 自定义事件渲染组件的公共 props：payload 必带；onReview 是审查视图入口（无会话上下文时缺省） */
type CustomEventViewProps = { payload: never; onReview?: () => void }

/**
 * 自定义事件渲染注册表：name → 渲染组件。新结构化消息在此注册一行。
 * 导出供一致性 lock 测试使用（shared 事件名常量 ↔ 本表，防 name 漂移）。
 */
export const CUSTOM_EVENT_VIEWS: Record<string, React.ComponentType<CustomEventViewProps>> = {
    [TURN_DIFF_EVENT]: TurnDiffCard as unknown as React.ComponentType<CustomEventViewProps>,
}

/** 单个 custom-event block → 渲染节点；未注册事件返回 null（调用方跳过） */
function renderCustomEvent(block: UserCustomEventBlock, key: string, onReview?: () => void): React.ReactNode {
    const View = CUSTOM_EVENT_VIEWS[block.name]
    if (!View) return null
    return <View key={key} payload={block.value as never} onReview={onReview} />
}

/** 单个 block → 渲染节点；未注册类型返回 null（调用方跳过）。key 由调用方（位置序）提供 */
function renderBlock(block: ContentBlock, key: string, onReview?: () => void): React.ReactNode {
    switch (block.type) {
        case 'text':
            // 非流式、不带 slash command / mention：custom 消息由 mobi 生成，无用户输入语法。
            // x-markdown-inline：收起块级 p 边距、链接色随系统行灰调（markdown.css 尾部作用域规则）
            return <Markdown key={key} content={block.text} className="x-markdown-inline" />
        case 'custom-event':
            return renderCustomEvent(block, key, onReview)
        default:
            // image/document/quote：词汇表已定义但渲染器首期未对 custom 通道开放，跳过
            return null
    }
}

/** 自定义消息渲染（如「fork 自会话 xxx」溯源行）：无边框系统行形态 */
export const CustomBlockView = memo(function CustomBlockView({ block, sessionId }: { block: CustomBlockType; sessionId?: string }) {
    const { token } = antTheme.useToken()
    const openReviewTab = useWorkspaceStore((s) => s.openReviewTab)
    const setExpanded = useWorkspaceStore((s) => s.setExpanded)

    // 「审查」入口：开审查 tab 强制落「上一轮」档并展开 inspector（折叠时只开 tab 等于没做；
    // 已有 review tab 停在别的档时也拉回——入口语义是「看这轮的审查」，不是「切到审查面板」）
    const onReview = sessionId ? () => {
        openReviewTab(sessionId, JSON.stringify({ kind: 'turn' }))
        setExpanded(sessionId, true)
    } : undefined

    const nodes = block.blocks.map((block: ContentBlock, i) => renderBlock(block, `${i}:${block.type}`, onReview))

    return (
        <div style={{ padding: '4px 0', fontSize: 12, color: token.colorTextTertiary }}>
            {nodes}
        </div>
    )
})
