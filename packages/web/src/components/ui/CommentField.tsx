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
import { Button, Input } from 'antd'
import { CheckOutlined, CloseOutlined } from '@ant-design/icons'
import styled from '@emotion/styled'
import { useTranslation } from 'react-i18next'
import { commentTextareaAction } from '@/core/lib/commentTextareaKeys'

/**
 * 引用评论编辑器（引用评论浮层与 composer 引用列表卡行内编辑的共享形态）：
 * 单行起步多行自适应的 textarea + 底部 meta 行——左侧字数（0/500，接近上限转警示色），
 * 右侧动作钮（未填写 = 关闭 ×；有内容 = 保存 ✓）。对齐由 flex 收口，不再内叠进
 * textarea（单行/多行高度变化下内叠按钮永远对不齐）。
 */

/** 字数接近上限的警示阈值（超过转警示色，提示将被 maxLength 截断） */
const COUNT_WARN_RATIO = 0.9

const Wrap = styled.div`
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px 8px;
    border: 1px solid var(--ant-color-border);
    border-radius: 8px;
    background: var(--ant-color-bg-container);
    transition: border-color 0.15s;

    &:focus-within {
        border-color: var(--ant-color-primary);
    }
`

const Area = styled(Input.TextArea)`
    padding: 0 !important;
    border: none !important;
    background: transparent !important;
    font-size: 12px;
    line-height: 20px;
    box-shadow: none !important;
`

const Meta = styled.div`
    display: flex;
    align-items: center;
    justify-content: space-between;
`

const Count = styled.span<{ $warn: boolean }>`
    font-size: 10px;
    line-height: 16px;
    font-variant-numeric: tabular-nums;
    color: ${({ $warn }) => ($warn ? 'var(--ant-color-warning)' : 'var(--ant-color-text-quaternary)')};
`

const Actions = styled.div`
    display: flex;
    align-items: center;
    gap: 2px;
`

export interface CommentFieldProps {
    /** 续编辑回填（同片段重开时带出已有评论） */
    initialComment?: string
    /** 字数上限（与 maxLength 同源，默认由调用方传 QUOTE_EXCERPT_MAX） */
    maxLength: number
    /** 自动聚焦（浮层打开时 true；列表卡行内编辑也 true） */
    autoFocus?: boolean
    /** 保存：trim 后空串以 undefined 上报（= 无评论） */
    onSave: (comment: string | undefined) => void
    /** 关闭（× / Esc；点外关闭由调用方承担） */
    onClose: () => void
    /** 占位文案 */
    placeholder: string
    /** 测试定位（两个宿主的 testid 不同） */
    testIdPrefix?: string
}

export function CommentField({
    initialComment,
    maxLength,
    autoFocus = false,
    onSave,
    onClose,
    placeholder,
    testIdPrefix = 'quote-comment',
}: CommentFieldProps) {
    const { t } = useTranslation()
    const [comment, setComment] = useState(initialComment ?? '')
    const trimmed = comment.trim()
    const hasContent = trimmed.length > 0
    const countWarn = comment.length >= maxLength * COUNT_WARN_RATIO

    const save = () => onSave(hasContent ? trimmed : undefined)

    return (
        <Wrap>
            <Area
                autoFocus={autoFocus}
                autoSize={{ minRows: 1, maxRows: 5 }}
                maxLength={maxLength}
                placeholder={placeholder}
                value={comment}
                data-testid={`${testIdPrefix}-input`}
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
            <Meta>
                <Count $warn={countWarn} data-testid={`${testIdPrefix}-count`}>{comment.length}/{maxLength}</Count>
                <Actions>
                    {hasContent ? (
                        <Button
                            type="text"
                            size="small"
                            aria-label={t('common.save')}
                            data-testid={`${testIdPrefix}-save`}
                            icon={<CheckOutlined />}
                            onClick={save}
                        />
                    ) : (
                        <Button
                            type="text"
                            size="small"
                            aria-label={t('common.close')}
                            data-testid={`${testIdPrefix}-close`}
                            icon={<CloseOutlined />}
                            onClick={onClose}
                        />
                    )}
                </Actions>
            </Meta>
        </Wrap>
    )
}
