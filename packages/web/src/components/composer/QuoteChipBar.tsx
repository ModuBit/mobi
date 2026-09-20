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

import { memo } from 'react'
import { Popover } from 'antd'
import { Quote } from 'lucide-react'
import { CloseOutlined } from '@ant-design/icons'
import styled from '@emotion/styled'
import { useTranslation } from 'react-i18next'
import type { PendingQuoteRef } from '@/domain/chat/composerSegments'

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

const ItemText = styled.span`
    flex: 1;
    min-width: 0;
    font-size: 12px;
    line-height: 18px;
    color: var(--ant-color-text-secondary);
    word-break: break-word;
    white-space: pre-wrap;
`

const RemoveButton = styled(CloseOutlined)`
    flex-shrink: 0;
    margin-top: 3px;
    font-size: 10px;
    color: var(--ant-color-text-quaternary);
    cursor: pointer;
    transition: color 0.15s;
    &:hover {
        color: var(--ant-color-text-secondary);
    }
`

interface QuoteChipBarProps {
    quotes: PendingQuoteRef[]
    onRemove: (messageId: string) => void
}

/**
 * 引用胶囊 + 展开列表卡（spec「Composer 呈现」）：
 * 胶囊一行收纳（composer 上方空间宝贵，引用是次要元数据），点击展开浮层列表卡核对——
 * 编号与 prompt 的 quote index、气泡引用组编号同源（数组序），评论编辑入口由票 05 在条目内补。
 */
export const QuoteChipBar = memo(function QuoteChipBar({ quotes, onRemove }: QuoteChipBarProps) {
    const { t } = useTranslation()
    if (quotes.length === 0) return null

    const list = (
        <ListCard data-testid="quote-list">
            {quotes.map((q, i) => (
                <Item key={q.messageId} data-testid={`quote-item-${i}`}>
                    <ItemIndex>{i + 1}.</ItemIndex>
                    <ItemText>{q.excerpt}</ItemText>
                    <RemoveButton
                        aria-label={t('composer.removeQuote')}
                        data-testid={`quote-remove-${i}`}
                        onClick={() => onRemove(q.messageId)}
                    />
                </Item>
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
