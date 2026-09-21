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

import { memo, useRef, useState } from 'react'
import { Button } from 'antd'
import styled from '@emotion/styled'
import { useTranslation } from 'react-i18next'
import type { PendingQuoteRef } from '@/domain/chat/composerSegments'
import { computeQuoteLayerPlacement } from './quoteLayerPlacement'
import { commentTextareaAction } from '@/core/lib/commentTextareaKeys'

/** 浮层宽度：容纳两行评论输入 */
const POPOVER_WIDTH = 260
/** 翻转阈值：选区顶边高于此值才放上方（评论浮层高，阈值比动作条大） */
const FLIP_THRESHOLD_PX = 140

const Layer = styled.div`
    position: fixed;
    z-index: 1050;
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: ${POPOVER_WIDTH}px;
    padding: 8px;
    background: var(--ant-color-bg-elevated);
    border: 1px solid var(--ant-color-border);
    border-radius: 10px;
    box-shadow: var(--ant-box-shadow-secondary);
`

const Input = styled.textarea`
    width: 100%;
    min-height: 44px;
    padding: 6px 8px;
    border: 1px solid var(--ant-color-border);
    border-radius: 6px;
    background: var(--ant-color-bg-container);
    color: var(--ant-color-text);
    font-size: 12px;
    line-height: 18px;
    resize: none;
    outline: none;
    &:focus {
        border-color: var(--ant-color-primary);
    }
`

const ActionBar = styled.div`
    display: flex;
    justify-content: flex-end;
    gap: 6px;
`

interface QuoteCommentInputProps {
    /** 已捕获的引用提案与选区几何（评论是「添加到对话」后的第二步） */
    quote: PendingQuoteRef
    rect: DOMRect
    /** 确认：comment 为空串时作为「无评论」落引用 */
    onConfirm: (quote: PendingQuoteRef) => void
    onCancel: () => void
}

/**
 * 引用评论输入浮层（spec「评论流」）：「添加到对话」确认后的第二步——
 * 评论可选（空 = 无评论引用）；Enter 保存（IME 组合中的回车不提交）、Shift+Enter 换行、
 * Esc/取消不创建。不做 mousedown 拦截——输入框内点击定位光标是正常编辑行为，
 * 点浮层外的取消语义由调用方的 mousedown-outside 监听（data-quote-layer 判定）承担。
 * fixed 定位锚定选区几何并钳制在视口内，与 QuoteSelectionPopover 同族同生命周期。
 */
export const QuoteCommentInput = memo(function QuoteCommentInput({
    quote,
    rect,
    onConfirm,
    onCancel,
}: QuoteCommentInputProps) {
    const { t } = useTranslation()
    const [comment, setComment] = useState('')
    const inputRef = useRef<HTMLTextAreaElement>(null)

    const confirm = () => {
        const trimmed = comment.trim()
        onConfirm(trimmed.length > 0 ? { ...quote, comment: trimmed } : quote)
    }

    // 定位规则（上翻 + 视口钳制）由 quoteLayerPlacement 单处承载，本组件只声明宽度与阈值
    const { top, left, above } = computeQuoteLayerPlacement(rect, POPOVER_WIDTH, FLIP_THRESHOLD_PX)

    return (
        <Layer
            data-quote-layer="comment"
            data-testid="quote-comment-input"
            style={{ top, left, transform: above ? 'translateY(-100%)' : undefined }}
        >
            <Input
                ref={inputRef}
                autoFocus
                placeholder={t('composer.quoteCommentPlaceholder')}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                onKeyDown={(e) => {
                    const action = commentTextareaAction(e)
                    if (action === 'submit') {
                        e.preventDefault()
                        confirm()
                    } else if (action === 'cancel') {
                        e.stopPropagation()
                        onCancel()
                    }
                }}
            />
            <ActionBar>
                <Button size="small" onClick={onCancel}>{t('common.cancel')}</Button>
                <Button
                    type="primary"
                    size="small"
                    data-testid="quote-comment-save"
                    onClick={confirm}
                >
                    {t('common.save')}
                </Button>
            </ActionBar>
        </Layer>
    )
})
