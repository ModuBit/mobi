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

import { memo, useState } from 'react'
import { Popover } from 'antd'
import { Quote } from 'lucide-react'
import { CloseOutlined, EditOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import type { ComposerQuoteRef } from '@/domain/chat/composerSegments'
import { QUOTE_COMMENT_MAX } from '@mobi/shared'
import { CommentField } from '@/components/ui/CommentField'
import {
    QuoteChip,
    QuoteItemAction,
    QuoteItemBody,
    QuoteItemComment,
    QuoteItemIndex,
    QuoteItemText,
    QuoteListBox,
} from '@/components/chat/userBlocks/QuoteListCard'

interface QuoteChipBarProps {
    quotes: ComposerQuoteRef[]
    /** 删除按条目级 uid 寻址（同消息可挂多个不同片段，messageId 不唯一） */
    onRemove: (uid: string) => void
    /** 评论编辑保存（undefined = 清空评论）；缺省不渲染编辑入口 */
    onUpdateComment?: (uid: string, comment: string | undefined) => void
    /** 一键清空全部引用（胶囊旁 ×） */
    onClearAll?: () => void
    /** 条目点击定位源消息（滚动 + 高亮）；缺省纯展示 */
    onLocate?: (messageId: string) => void
}

/** 列表卡单条目：excerpt 全文（composer 侧不截断：编辑核对需要全文）+ 评论行 + 编辑/删除动作 */
function QuoteItem({
    quote,
    index,
    canEditComment,
    canLocate,
    onRemove,
    onUpdateComment,
    onLocate,
}: {
    quote: ComposerQuoteRef
    index: number
    canEditComment: boolean
    canLocate: boolean
    onRemove: (uid: string) => void
    onUpdateComment?: (uid: string, comment: string | undefined) => void
    onLocate?: (messageId: string) => void
}) {
    const { t } = useTranslation()
    const [editing, setEditing] = useState(false)

    return (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }} data-testid={`quote-item-${index}`}>
            <QuoteItemIndex>{index + 1}.</QuoteItemIndex>
            <QuoteItemBody>
                <QuoteItemText
                    // 点 excerpt 定位源消息（编辑态 textarea 同在 ItemBody，但不落此 onClick，互不干扰）
                    onClick={canLocate ? () => onLocate?.(quote.messageId) : undefined}
                    style={canLocate ? { cursor: 'pointer' } : undefined}
                >
                    {quote.excerpt}
                </QuoteItemText>
                {!editing && quote.comment !== undefined && (
                    <QuoteItemComment data-testid={`quote-comment-${index}`}>{quote.comment}</QuoteItemComment>
                )}
                {editing && (
                    <CommentField
                        testIdPrefix={`quote-item-${index}`}
                        initialComment={quote.comment}
                        maxLength={QUOTE_COMMENT_MAX}
                        autoFocus
                        placeholder={t('composer.quoteCommentPlaceholder')}
                        onSave={(comment) => {
                            onUpdateComment?.(quote.uid, comment)
                            setEditing(false)
                        }}
                        onClose={() => setEditing(false)}
                    />
                )}
            </QuoteItemBody>
            <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                {canEditComment && !editing && (
                    <QuoteItemAction
                        role="button"
                        aria-label={t('composer.quoteEditComment')}
                        data-testid={`quote-edit-comment-${index}`}
                        onClick={() => setEditing(true)}
                    >
                        <EditOutlined />
                    </QuoteItemAction>
                )}
                <QuoteItemAction
                    role="button"
                    aria-label={t('composer.removeQuote')}
                    data-testid={`quote-remove-${index}`}
                    onClick={() => onRemove(quote.uid)}
                >
                    <CloseOutlined />
                </QuoteItemAction>
            </span>
        </div>
    )
}

/**
 * 引用胶囊 + 展开列表卡（spec「Composer 呈现」）：
 * 胶囊一行收纳（composer 上方空间宝贵，引用是次要元数据），点击展开浮层列表卡核对——
 * 编号与 prompt 的 quote index、气泡引用组编号同源（数组序）；评论在列表卡内可见、可编辑
 * （excerpt 只读：引用忠实于源消息，评论才是用户的话）。
 * 视觉词汇共享自 QuoteListCard（与气泡 header 引用 chip 同源，宿主差异仅编辑/删除动作）。
 */
export const QuoteChipBar = memo(function QuoteChipBar({
    quotes,
    onRemove,
    onUpdateComment,
    onClearAll,
    onLocate,
}: QuoteChipBarProps) {
    const { t } = useTranslation()
    if (quotes.length === 0) return null

    const list = (
        <QuoteListBox data-testid="quote-list">
            {quotes.map((q, i) => (
                <QuoteItem
                    key={q.uid}
                    quote={q}
                    index={i}
                    canEditComment={!!onUpdateComment}
                    canLocate={!!onLocate}
                    onRemove={onRemove}
                    onUpdateComment={onUpdateComment}
                    onLocate={onLocate}
                />
            ))}
        </QuoteListBox>
    )

    return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Popover content={list} trigger="click" placement="topLeft" overlayClassName="quote-list-popover">
                <QuoteChip type="button" data-testid="quote-chip">
                    <Quote size={12} />
                    {t('composer.quoteCount', { count: quotes.length })}
                </QuoteChip>
            </Popover>
            {onClearAll && (
                <QuoteItemAction
                    role="button"
                    aria-label={t('composer.clearQuotes')}
                    data-testid="quote-clear-all"
                    onClick={onClearAll}
                >
                    <CloseOutlined />
                </QuoteItemAction>
            )}
        </span>
    )
})
