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
import styled from '@emotion/styled'
import { useTranslation } from 'react-i18next'
import type { ComposerQuoteRef } from '@/domain/chat/composerSegments'
import { QUOTE_COMMENT_MAX } from '@mobi/shared'
import { CommentField } from '@/components/ui/CommentField'

/** 引用列表卡单条目间距（条间分隔线的统一节奏） */
const ITEM_GAP = 10

const Chip = styled.button`
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 10px;
    border-radius: 999px;
    border: 1px solid var(--ant-color-border-secondary);
    background: var(--ant-color-bg-container);
    font-size: 12px;
    line-height: 18px;
    color: var(--ant-color-text-secondary);
    cursor: pointer;
    transition: border-color 0.15s, color 0.15s;

    &:hover {
        border-color: var(--ant-color-border);
        color: var(--ant-color-text);
    }
`

const ListCard = styled.div`
    /* 恒定宽度：编辑态条目只剩窄的 CommentField 时 shrink-to-fit 会整卡收窄，
       展示/编辑宽度跳变（2026-09-23 验收反馈）；与 excerpt 撑满态取同一量级 */
    width: 420px;
    max-width: 100%;
    max-height: 320px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: ${ITEM_GAP}px;
`

const Item = styled.div`
    display: flex;
    gap: 8px;
    align-items: flex-start;
    &:not(:last-child) {
        padding-bottom: ${ITEM_GAP}px;
        border-bottom: 1px solid var(--ant-color-border-quaternary);
    }
`

const ItemIndex = styled.span`
    flex-shrink: 0;
    min-width: 18px;
    font-size: 12px;
    line-height: 18px;
    color: var(--ant-color-text-tertiary);
    font-variant-numeric: tabular-nums;
`

const ItemBody = styled.div`
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
`

const ItemText = styled.span`
    font-size: 12px;
    line-height: 18px;
    color: var(--ant-color-text-secondary);
    word-break: break-word;
    white-space: pre-wrap;
`

/** 评论行：与所选文本区分的更弱色调（评论是用户的话，附在引用内容之下） */
const ItemComment = styled.span`
    font-size: 12px;
    line-height: 18px;
    color: var(--ant-color-text-tertiary);
    word-break: break-word;
    white-space: pre-wrap;
`

const ItemAction = styled.span`
    flex-shrink: 0;
    font-size: 10px;
    color: var(--ant-color-text-quaternary);
    cursor: pointer;
    transition: color 0.15s;
    &:hover {
        color: var(--ant-color-text-secondary);
    }
`

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

/** 列表卡单条目：excerpt 全文 + 评论行 + 删除/评论编辑动作；点 excerpt 定位源消息 */
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
        <Item data-testid={`quote-item-${index}`}>
            <ItemIndex>{index + 1}.</ItemIndex>
            <ItemBody>
                <ItemText
                    // 点 excerpt 定位源消息（编辑态 textarea 同在 ItemBody，但不落此 onClick，互不干扰）
                    onClick={canLocate ? () => onLocate?.(quote.messageId) : undefined}
                    style={canLocate ? { cursor: 'pointer' } : undefined}
                >
                    {quote.excerpt}
                </ItemText>
                {!editing && quote.comment !== undefined && (
                    <ItemComment data-testid={`quote-comment-${index}`}>{quote.comment}</ItemComment>
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
            </ItemBody>
            <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                {canEditComment && !editing && (
                    <ItemAction
                        role="button"
                        aria-label={t('composer.quoteEditComment')}
                        data-testid={`quote-edit-comment-${index}`}
                        onClick={() => setEditing(true)}
                    >
                        <EditOutlined />
                    </ItemAction>
                )}
                <ItemAction
                    role="button"
                    aria-label={t('composer.removeQuote')}
                    data-testid={`quote-remove-${index}`}
                    onClick={() => onRemove(quote.uid)}
                >
                    <CloseOutlined />
                </ItemAction>
            </span>
        </Item>
    )
}

/**
 * 引用胶囊 + 展开列表卡（spec「Composer 呈现」）：
 * 胶囊一行收纳（composer 上方空间宝贵，引用是次要元数据），点击展开浮层列表卡核对——
 * 编号与 prompt 的 quote index、气泡引用组编号同源（数组序）；评论在列表卡内可见、可编辑
 * （excerpt 只读：引用忠实于源消息，评论才是用户的话）。
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
        <ListCard data-testid="quote-list">
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
        </ListCard>
    )

    return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Popover content={list} trigger="click" placement="topLeft">
                <Chip type="button" data-testid="quote-chip">
                    <Quote size={12} />
                    {t('composer.quoteCount', { count: quotes.length })}
                </Chip>
            </Popover>
            {onClearAll && (
                <ItemAction
                    role="button"
                    aria-label={t('composer.clearQuotes')}
                    data-testid="quote-clear-all"
                    onClick={onClearAll}
                >
                    <CloseOutlined />
                </ItemAction>
            )}
        </span>
    )
})
