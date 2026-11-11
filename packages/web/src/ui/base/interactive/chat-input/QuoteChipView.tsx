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

import { useState } from 'react'
import styled from '@emotion/styled'
import { Quote } from 'lucide-react'
import { CloseOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import type { NodeViewProps } from '@tiptap/react'
import { NodeViewWrapper } from '@tiptap/react'
import { QUOTE_COMMENT_MAX } from '@mobi/shared'
import { CommentField } from '@/ui/shared/CommentField'
import { Popover } from '@/ui/base/interactive/popover/Popover'
import type { ChatInputQuoteOptions } from './chatInputQuoteTypes'

/** chip 内 excerpt 预览截断宽度：输入流内联形态要短（全文语义由定位跳转承载） */
const EXCERPT_MAX_WIDTH = 180

/** chip 根：inline-flex 随文字流排版；NodeSelection 选中态（Backspace 第一段）高亮边框 */
const Chip = styled.span`
    display: inline-flex;
    align-items: center;
    gap: 4px;
    max-width: ${EXCERPT_MAX_WIDTH + 56}px;
    margin: 0 2px;
    padding: 1px 6px;
    border-radius: var(--radius-pill);
    border: 1px solid var(--ant-color-border-secondary);
    background: var(--ant-color-bg-container);
    font-size: 12px;
    line-height: 18px;
    color: var(--ant-color-text-secondary);
    cursor: pointer;
    vertical-align: baseline;
    transition: border-color 0.15s, color 0.15s;

    &[data-selected='true'] {
        border-color: var(--ant-color-primary);
        color: var(--ant-color-primary);
    }

    &:hover {
        border-color: var(--ant-color-border);
        color: var(--ant-color-text);
    }
`

/** excerpt 单行截断（评论已存在时尾部加批注标记） */
const Excerpt = styled.span`
    max-width: ${EXCERPT_MAX_WIDTH}px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
`

/** chip 尾部 ×（删除整条引用） */
const RemoveBtn = styled.span`
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    font-size: 10px;
    color: var(--ant-color-text-quaternary);
    cursor: pointer;
    transition: color 0.15s;

    &:hover {
        color: var(--ant-color-text-secondary);
    }
`

/**
 * 引用 chip 的 NodeView（React 渲染）：输入流内联 pill（Claude Desktop 同款形态）。
 * 点击 chip 主体弹评论编辑浮层（CommentField 与气泡 header 引用编辑同源）；× 直接删除节点。
 * 定位交互在浮层内的「定位」动作（避免与打开浮层的点击语义抢通道）。
 */
export function QuoteChipView({ node, updateAttributes, deleteNode, extension, selected }: NodeViewProps) {
    const { t } = useTranslation()
    const [open, setOpen] = useState(false)
    const options = extension.options as ChatInputQuoteOptions
    const attrs = node.attrs as { messageId: string; excerpt: string; comment?: string | null }
    const hasComment = attrs.comment != null && attrs.comment !== ''

    return (
        // contentEditable=false：NodeView 容器默认已隔离，显式声明防御浏览器默认编辑行为
        <NodeViewWrapper as="span" contentEditable={false} data-selected={selected || undefined} style={{ display: 'inline' }}>
            <Popover
                open={open}
                onOpenChange={setOpen}
                trigger="click"
                side="top"
                align="start"
                maxWidth={452}
                content={
                    <div style={{ width: 'min(360px, calc(100vw - 48px))', display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <Excerpt style={{ maxWidth: '100%', whiteSpace: 'normal', color: 'var(--ant-color-text)' }}>
                            {attrs.excerpt}
                        </Excerpt>
                        <CommentField
                            testIdPrefix="chat-input-quote"
                            initialComment={attrs.comment ?? undefined}
                            maxLength={QUOTE_COMMENT_MAX}
                            autoFocus
                            placeholder={t('composer.quoteCommentPlaceholder')}
                            onSave={(comment) => {
                                updateAttributes({ comment: comment || null })
                                setOpen(false)
                            }}
                            onClose={() => setOpen(false)}
                        />
                        {options.onLocate && (
                            <span
                                role="button"
                                tabIndex={0}
                                style={{ fontSize: 12, color: 'var(--ant-color-text-tertiary)', cursor: 'pointer', alignSelf: 'flex-start' }}
                                onClick={() => {
                                    options.onLocate?.(attrs.messageId)
                                    setOpen(false)
                                }}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                        e.preventDefault()
                                        options.onLocate?.(attrs.messageId)
                                        setOpen(false)
                                    }
                                }}
                            >
                                {t('composer.quoteLocate')}
                            </span>
                        )}
                    </div>
                }
            >
                <Chip data-selected={selected || undefined} data-testid="chat-input-quote-chip">
                    <Quote size={12} style={{ flexShrink: 0 }} />
                    <Excerpt>{attrs.excerpt}</Excerpt>
                    {hasComment && <span aria-hidden style={{ flexShrink: 0 }}>✎</span>}
                    <RemoveBtn
                        role="button"
                        aria-label={t('composer.removeQuote')}
                        data-testid="chat-input-quote-remove"
                        onClick={(e) => {
                            e.stopPropagation()
                            deleteNode()
                        }}
                    >
                        <CloseOutlined />
                    </RemoveBtn>
                </Chip>
            </Popover>
        </NodeViewWrapper>
    )
}
