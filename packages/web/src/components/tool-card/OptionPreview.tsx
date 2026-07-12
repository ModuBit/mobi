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

import type { ReactNode } from 'react'
import { memo, useMemo } from 'react'
import { Popover, theme as antTheme } from 'antd'
import { Eye } from 'lucide-react'
import styled from '@emotion/styled'
import DOMPurify from 'dompurify'
import { Markdown } from '@/components/ui/Markdown'

/** markdown 块级语法特征（标题/列表/引用/代码围栏）；命中则即便被 HTML 元素包裹也按 markdown 处理 */
const MARKDOWN_BLOCK_SYNTAX = /(^|\n)\s*(#{1,6}\s|[-*+]\s|>\s|```)/

/**
 * 判断整段内容是否为 HTML 片段
 *
 * 不靠「以 < 开头」这种粗糙启发式（markdown 源码里的 <details>、<br>、`<` 比较符都会误判），
 * 而是用 DOMParser 真正解析一遍：若 body 的直接子节点中存在「裸文本节点」，说明内容混杂了
 * 非标签文本（典型的 markdown 源码特征），按 markdown 渲染；仅当 body 全由元素节点构成时才视为 HTML。
 *
 * 额外兜底：即便 body 全是元素（如 `<div>\n# 标题\n</div>` 这种 markdown 被 HTML 包裹的形式），
 * 只要文本含 markdown 块语法特征，仍按 markdown 处理——避免误判后走 HTML 分支显示裸源码。
 */
function isHtmlContent(content: string): boolean {
    const trimmed = content.trim()
    if (!trimmed) return false
    if (MARKDOWN_BLOCK_SYNTAX.test(trimmed)) return false
    const doc = new DOMParser().parseFromString(trimmed, 'text/html')
    return !Array.from(doc.body.childNodes).some(
        node => node.nodeType === Node.TEXT_NODE && (node.textContent?.trim().length ?? 0) > 0,
    )
}

function PreviewContent({ content }: { content: string }) {
    const { token } = antTheme.useToken()
    const baseStyle: React.CSSProperties = {
        maxHeight: 300,
        overflow: 'auto',
        fontSize: 13,
        lineHeight: 1.6,
        color: token.colorText,
    }
    // 判定结果按内容缓存，避免 Popover 重渲染时重复 DOMParser 解析
    const isHtml = useMemo(() => isHtmlContent(content), [content])
    // HTML 分支：preview 内容来自模型/链路，用 DOMPurify 清洗后再注入，拦截 <script>/onerror 等
    const sanitizedHtml = useMemo(
        () => (isHtml ? DOMPurify.sanitize(content) : ''),
        [isHtml, content],
    )
    if (isHtml) {
        return (
            <div
                style={baseStyle}
                dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
            />
        )
    }
    // markdown preview：等宽字体，对齐 SDK 的 markdown preview「monospace box」观感。
    // 不在外层强制 white-space——ASCII 图依赖 XMarkdown 代码块自带的 pre 保持列对齐，
    // 普通文本自然换行；若外层加 pre 会与 Markdown 的 breaks:true 冲突产生双倍行距。
    return (
        <div style={{ ...baseStyle, fontFamily: 'var(--font-mono)' }}>
            <Markdown content={content} typing={false} />
        </div>
    )
}

type OptionPreviewProps = {
    preview: string
    children: ReactNode
}

const EyeTrigger = styled.span<{ $token: ReturnType<typeof antTheme.useToken>['token'] }>`
    flex-shrink: 0;
    margin-left: 4px;
    padding: 4px;
    display: flex;
    align-items: center;
    color: ${props => props.$token.colorTextQuaternary};
    transition: color 0.2s;
    cursor: pointer;

    &:hover {
        color: ${props => props.$token.colorTextSecondary};
    }
`

/**
 * 选项预览包装器
 * hover 或点击 Eye 图标触发 Popover
 */
export const OptionPreview = memo(function OptionPreview({ preview, children }: OptionPreviewProps) {
    const { token } = antTheme.useToken()
    const content = <PreviewContent content={preview} />

    const overlayInnerStyle = useMemo<React.CSSProperties>(() => ({
        background: token.colorBgElevated,
        borderRadius: token.borderRadiusLG,
        border: `1px solid ${token.colorBorderSecondary}`,
        boxShadow: token.boxShadow,
    }), [token.colorBgElevated, token.borderRadiusLG, token.colorBorderSecondary, token.boxShadow])

    return (
        <div style={{ display: 'flex', width: '100%', alignItems: 'flex-start' }}>
            <div style={{ minWidth: 0, flex: 1 }}>{children}</div>
            <EyeTrigger
                $token={token}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
            >
                <Popover
                    trigger={['hover', 'click']}
                    placement="left"
                    mouseEnterDelay={0.15}
                    mouseLeaveDelay={0.1}
                    overlayStyle={{ maxWidth: 360 }}
                    overlayInnerStyle={overlayInnerStyle}
                    styles={{ container: { padding: 0 } }}
                    content={content}
                    arrow={false}
                >
                    <Eye size={14} />
                </Popover>
            </EyeTrigger>
        </div>
    )
})
