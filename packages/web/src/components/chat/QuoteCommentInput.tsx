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
import { Button, Input } from 'antd'
import { CheckOutlined, CloseOutlined } from '@ant-design/icons'
import styled from '@emotion/styled'
import { useTranslation } from 'react-i18next'
import { QUOTE_EXCERPT_MAX } from '@mobi/shared'
import { computeQuoteLayerPlacement } from './quoteLayerPlacement'
import { commentTextareaAction } from '@/core/lib/commentTextareaKeys'

/** 浮层宽度：多行评论输入条 */
const POPOVER_WIDTH = 280
/** 翻转阈值：选区顶边高于此值才放上方（评论浮层高，阈值比动作条大） */
const FLIP_THRESHOLD_PX = 140
/** 估算高度（下缘钳制兜底）：单行起（autoSize 向下长高） */
const ESTIMATED_HEIGHT_PX = 56

/**
 * 单行起步、多行自适应的评论输入容器：动作按钮叠在输入框内部右下角——
 * 未填写时显示关闭（×，等价点浮层外取消）、有内容时显示保存（✓）。
 */
const Layer = styled.div`
    position: fixed;
    z-index: 1050;
    width: ${POPOVER_WIDTH}px;
    padding: 3px;
    background: var(--ant-color-bg-elevated);
    border: 1px solid var(--ant-color-border);
    border-radius: 10px;
    box-shadow: var(--ant-box-shadow-secondary);
`

const InputWrap = styled.div`
    position: relative;
`

/** 输入框右侧留出按钮位（padding-right 让文字不被内叠按钮压住） */
const CommentArea = styled(Input.TextArea)`
    padding-right: 40px !important;
    border-radius: 8px;
`

/** 内叠动作钮：贴右下（单行时恰为垂直居中，多行时随高度下沉） */
const CornerAction = styled.div`
    position: absolute;
    right: 6px;
    bottom: 6px;
`

interface QuoteCommentInputProps {
    /** 续编辑回填：同片段重复添加时带出已有评论（首添加为空） */
    initialComment?: string
    rect: DOMRect
    /** 保存：trim 后空串以 undefined 上报（= 无评论引用） */
    onSave: (comment: string | undefined) => void
    /** 关闭（× / Esc / 点浮层外，选区保留） */
    onClose: () => void
}

/**
 * 引用评论输入浮层（spec「评论流」）：引用已在 composer（「添加到对话」即落条目），
 * 此浮层只负责补充评论——可选（空保存 = 无评论引用）、多行自适应（autoSize ≤5 行）、
 * Enter/✓ 保存（IME 组合中的回车不提交）、×/Esc/点浮层外关闭（选区保留，
 * 见 ChatContainer handleQuoteCancel）。fixed 定位锚定选区几何并钳制在视口内，
 * 与 QuoteSelectionPopover 同族同生命周期。
 */
export const QuoteCommentInput = memo(function QuoteCommentInput({
    initialComment,
    rect,
    onSave,
    onClose,
}: QuoteCommentInputProps) {
    const { t } = useTranslation()
    const [comment, setComment] = useState(initialComment ?? '')

    const save = () => {
        const trimmed = comment.trim()
        onSave(trimmed.length > 0 ? trimmed : undefined)
    }

    // 定位规则（上翻 + 视口钳制）由 quoteLayerPlacement 单处承载，本组件只声明宽度与阈值
    const { top, left, above } = computeQuoteLayerPlacement(rect, POPOVER_WIDTH, FLIP_THRESHOLD_PX, ESTIMATED_HEIGHT_PX)

    return (
        <Layer
            data-quote-layer="comment"
            data-testid="quote-comment-input"
            style={{ top, left, transform: above ? 'translateY(-100%)' : undefined }}
        >
            <InputWrap>
                <CommentArea
                    autoFocus
                    autoSize={{ minRows: 1, maxRows: 5 }}
                    maxLength={QUOTE_EXCERPT_MAX}
                    placeholder={t('composer.quoteCommentPlaceholder')}
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    onKeyDown={(e) => {
                        const action = commentTextareaAction(e)
                        if (action === 'submit') {
                            e.preventDefault()
                            save()
                        } else if (action === 'cancel') {
                            e.stopPropagation()
                            onClose()
                        }
                    }}
                />
                <CornerAction>
                    {comment.trim().length > 0 ? (
                        <Button
                            type="text"
                            size="small"
                            aria-label={t('common.save')}
                            data-testid="quote-comment-save"
                            icon={<CheckOutlined />}
                            onClick={save}
                        />
                    ) : (
                        <Button
                            type="text"
                            size="small"
                            aria-label={t('common.close')}
                            data-testid="quote-comment-close"
                            icon={<CloseOutlined />}
                            onClick={onClose}
                        />
                    )}
                </CornerAction>
            </InputWrap>
        </Layer>
    )
})
