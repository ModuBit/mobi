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
import type { ContentBlock } from '@mobi/shared'
import type { CustomBlock as CustomBlockType } from '@/domain/chat'
import { Markdown } from '@/components/ui/Markdown'

/**
 * 自定义消息渲染器（ADR 0002）：按 block.type 一级分发。
 * - text 段经 Markdown 渲染——内部动作（如 fork 溯源跳转）是文本中的 mobi:// 动作
 *   链接（ADR 0003），由 Markdown 链接拦截层统一分发，本组件无二级注册表
 * - 未注册的 block 类型跳过不渲染（向前兼容，未来在此注册新渲染器）
 */

/** 单个 block → 渲染节点；未注册类型返回 null（调用方跳过）。key 由调用方（位置序）提供 */
function renderBlock(block: ContentBlock, key: string): React.ReactNode {
    switch (block.type) {
        case 'text':
            // 非流式、不带 slash command / mention：custom 消息由 mobi 生成，无用户输入语法
            return <Markdown key={key} content={block.text} />
        default:
            // image/document/quote：词汇表已定义但渲染器首期未对 custom 通道开放，跳过
            return null
    }
}

/** 自定义消息渲染（如「fork 自会话 xxx」溯源行）：无边框系统行形态 */
export const CustomBlockView = memo(function CustomBlockView({ block }: { block: CustomBlockType }) {
    const { token } = antTheme.useToken()

    const nodes = block.blocks.map((block: ContentBlock, i) => renderBlock(block, `${i}:${block.type}`))

    return (
        <div style={{ padding: '4px 0', fontSize: 12, color: token.colorTextTertiary }}>
            {nodes}
        </div>
    )
})
