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
 * 流式未完成语法占位组件（注册名即 x-markdown 的默认名 `incomplete-${token}`）。
 *
 * 背景（dist useStreaming 源码）：hasNextChunk=true 的流式缓存把未闭合 token 扣在
 * pending 里隐身到闭合为止——emphasis / link / inline-code 是整段不可见，慢流下长
 * 强调句会隐身很久，也是流式观感「一顿一顿」的来源之一。此处注册的组件收到原文
 * （data-raw，encodeURIComponent 编码的 pending），把「隐身」变「渐进可见」：
 * 渲染已打出的部分内容，闭合时无缝替换为正式渲染。
 *
 * 只收渐进可见类：emphasis / link / inline-code。不加 skeleton——table 超过
 * header+separator 后官方即渐进渲染 pending、fenced code 逐字符提交、image 未闭合
 * 窗口极短，骨架屏在这些场景只会闪现（负优化）。
 */

import type { FC } from 'react'
import type { ComponentProps } from '@ant-design/x-markdown'

/** 从 data-raw 解码 pending 原文 */
function decodeRaw(props: ComponentProps): string {
    return decodeURIComponent(String(props['data-raw'] ?? ''))
}

/**
 * 未完成强调：`**加粗中` / `*斜体中` / `***都要` 按定界符层级渐进渲染为
 * strong / em / em>strong——与闭合后的正式渲染同形，闭合时零跳变
 */
export const IncompleteEmphasis: FC<ComponentProps> = (props) => {
    const match = decodeRaw(props).match(/^([*_]{1,3})([^*_]*)/)
    if (!match?.[2]) return null

    const [, symbols, content] = match
    switch (symbols.length) {
        case 1:
            return <em>{content}</em>
        case 2:
            return <strong>{content}</strong>
        case 3:
            return (
                <em>
                    <strong>{content}</strong>
                </em>
            )
        default:
            return null
    }
}

/** 未完成链接：显示 [text]( 中已打出的链接文字（过渡态不可交互） */
export const IncompleteLink: FC<ComponentProps> = (props) => {
    const raw = decodeRaw(props)
    const displayText = raw.match(/^\[([^\]]*)\]/)?.[1] ?? raw.slice(1)
    if (!displayText) return null
    return (
        <a style={{ pointerEvents: 'none' }}>
            {displayText}
        </a>
    )
}

/** 未完成行内代码：渲染去掉反引号的半截代码文本，闭合时零跳变 */
export const IncompleteInlineCode: FC<ComponentProps> = (props) => {
    const raw = decodeRaw(props)
    const text = raw.startsWith('`') ? raw.slice(1) : raw
    if (!text) return null
    return <code>{text}</code>
}

/** 注册表：并入 Markdown 的 components（默认名，无需配 incompleteMarkdownComponentMap） */
export const INCOMPLETE_COMPONENTS = {
    'incomplete-emphasis': IncompleteEmphasis,
    'incomplete-link': IncompleteLink,
    'incomplete-inline-code': IncompleteInlineCode,
} as const
