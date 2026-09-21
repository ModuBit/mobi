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
import { Button, Popover } from 'antd'
import { Quote } from 'lucide-react'
import { CloseOutlined, EditOutlined } from '@ant-design/icons'
import styled from '@emotion/styled'
import { useTranslation } from 'react-i18next'
import type { PendingQuoteRef } from '@/domain/chat/composerSegments'
import { commentTextareaAction } from '@/core/lib/commentTextareaKeys'

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
    max-width: 420px;
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

const CommentInput = styled.textarea`
    width: 100%;
    min-height: 36px;
    padding: 4px 6px;
    border: 1px solid var(--ant-color-border);
    border-radius: 6px;
    background: var(--ant-color-bg-container);
    color: var(--ant-color-text);
    font-size: 12px;
    line-height: 18px;
    resize: none;
    outline: none;
`

interface QuoteChipBarProps {
    quotes: PendingQuoteRef[]
    onRemove: (messageId: string) => void
    /** 评论编辑保存（undefined = 清空评论）；缺省不渲染编辑入口 */
    onUpdateComment?: (messageId: string, comment: string | undefined) => void
}

/** 列表卡单条目：excerpt 全文 + 评论行 + 删除/评论编辑动作 */
function QuoteItem({
    quote,
    index,
    canEditComment,
    onRemove,
    onUpdateComment,
}: {
    quote: PendingQuoteRef
    index: number
    canEditComment: boolean
    onRemove: (messageId: string) => void
    onUpdateComment?: (messageId: string, comment: string | undefined) => void
}) {
    const { t } = useTranslation()
    const [editing, setEditing] = useState(false)
    const [draft, setDraft] = useState(quote.comment ?? '')

    // 取消语义单点：退出编辑 + 恢复草稿为已保存评论（Esc 与取消按钮共用）
    const cancel = () => {
        setEditing(false)
        setDraft(quote.comment ?? '')
    }

    const saveComment = () => {
        const trimmed = draft.trim()
        onUpdateComment?.(quote.messageId, trimmed.length > 0 ? trimmed : undefined)
        setEditing(false)
    }

    return (
        <Item data-testid={`quote-item-${index}`}>
            <ItemIndex>{index + 1}.</ItemIndex>
            <ItemBody>
                <ItemText>{quote.excerpt}</ItemText>
                {!editing && quote.comment !== undefined && (
                    <ItemComment data-testid={`quote-comment-${index}`}>{quote.comment}</ItemComment>
                )}
                {editing ? (
                    <>
                        <CommentInput
                            autoFocus
                            value={draft}
                            placeholder={t('composer.quoteCommentPlaceholder')}
                            onChange={(e) => setDraft(e.target.value)}
                            onKeyDown={(e) => {
                                // 键位判定（含 IME 组合中 Enter 不提交）由 commentTextareaAction 单处承载
                                const action = commentTextareaAction(e)
                                if (action === 'submit') {
                                    e.preventDefault()
                                    saveComment()
                                } else if (action === 'cancel') {
                                    cancel()
                                }
                            }}
                        />
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                            <Button
                                size="small"
                                onClick={cancel}
                            >
                                {t('common.cancel')}
                            </Button>
                            <Button type="primary" size="small" onClick={saveComment}>
                                {t('common.save')}
                            </Button>
                        </div>
                    </>
                ) : null}
            </ItemBody>
            <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                {canEditComment && !editing && (
                    <ItemAction
                        role="button"
                        aria-label={t('composer.quoteEditComment')}
                        data-testid={`quote-edit-comment-${index}`}
                        onClick={() => {
                            setDraft(quote.comment ?? '')
                            setEditing(true)
                        }}
                    >
                        <EditOutlined />
                    </ItemAction>
                )}
                <ItemAction
                    role="button"
                    aria-label={t('composer.removeQuote')}
                    data-testid={`quote-remove-${index}`}
                    onClick={() => onRemove(quote.messageId)}
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
export const QuoteChipBar = memo(function QuoteChipBar({ quotes, onRemove, onUpdateComment }: QuoteChipBarProps) {
    const { t } = useTranslation()
    if (quotes.length === 0) return null

    const list = (
        <ListCard data-testid="quote-list">
            {quotes.map((q, i) => (
                <QuoteItem
                    key={q.messageId}
                    quote={q}
                    index={i}
                    canEditComment={!!onUpdateComment}
                    onRemove={onRemove}
                    onUpdateComment={onUpdateComment}
                />
            ))}
        </ListCard>
    )

    return (
        <Popover content={list} trigger="click" placement="topLeft">
            <Chip type="button" data-testid="quote-chip">
                <Quote size={12} />
                {t('composer.quoteCount', { count: quotes.length })}
            </Chip>
        </Popover>
    )
})
