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
 * agent 气泡 header 的「N 条注释」聚合 chip（spec .scratch/response-annotations 票 04）：
 * 正文中的回应批注 directive 去重计数，点击展开 popover 列表核对（原文 + 评论），
 * 条目点击定位跳转引用源消息。形态与用户消息的引用 chip（UserQuoteChip）对称。
 * 无 directive 或无批注数据时返回 null（header 槽零改动）。
 */

import { useState } from 'react'
import { Popover, theme } from 'antd'
import { useTranslation } from 'react-i18next'
import { Quote } from 'lucide-react'
import styled from '@emotion/styled'
import type { UserQuoteBlock } from '@mobi/shared'
import { collectQuoteDirectiveIndexes } from '@/domain/chat/quoteDirectives'
import { truncatePreview } from '@/core/lib/truncatePreview'

/** 列表卡单条目 excerpt 预览截断宽度（与用户引用列表卡同口径） */
const ITEM_PREVIEW_MAX = 120

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
    /* 恒定宽度（与用户引用列表卡同一量级）；窄屏由 quote-list-popover 锁死几何接管 */
    width: min(420px, calc(100vw - 48px));

    @media (max-width: 640px) {
        width: 100%;
    }

    max-height: min(320px, 60dvh);
    overflow-y: auto;
    display: flex;
    flex-direction: column;
`

const Item = styled.div<{ $divided: boolean }>`
    display: flex;
    gap: 8px;
    align-items: flex-start;
    padding: 5px 4px;
    cursor: pointer;
    transition: background 0.15s;
    &:hover {
        background: var(--ant-color-fill-quaternary);
    }
    ${({ $divided }) => ($divided ? 'border-top: 1px solid var(--ant-color-border-quaternary);' : '')}
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

export function AgentAnnotationChip({ text, quotes, onLocate }: {
    text: string
    quotes: readonly UserQuoteBlock[]
    onLocate: (messageId: string) => void
}) {
    const { t } = useTranslation()
    const { token } = theme.useToken()
    const [open, setOpen] = useState(false)
    const indexes = collectQuoteDirectiveIndexes(text)
    // 无 directive 或无对齐的批注数据（历史消息/伪造索引）不渲染 chip
    const entries = indexes
        .map(index => ({ index, quote: quotes[index - 1] }))
        .filter((e): e is { index: number; quote: UserQuoteBlock } => !!e.quote)
    if (entries.length === 0) return null

    return (
        <Popover
            trigger="click"
            placement="topLeft"
            overlayClassName="quote-list-popover"
            open={open}
            onOpenChange={setOpen}
            content={
                <ListCard data-testid="agent-annotation-list">
                    {entries.map((e, i) => (
                        <Item
                            key={e.index}
                            $divided={i > 0}
                            data-testid={`agent-annotation-item-${e.index}`}
                            onClick={() => {
                                setOpen(false)
                                onLocate(e.quote.messageId)
                            }}
                        >
                            <ItemIndex>{e.index}.</ItemIndex>
                            <Quote size={12} style={{ flexShrink: 0, marginTop: 3, color: token.colorTextTertiary }} />
                            <span style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                                <ItemText>{truncatePreview(e.quote.excerpt, ITEM_PREVIEW_MAX)}</ItemText>
                                {e.quote.comment && <ItemComment>{e.quote.comment}</ItemComment>}
                            </span>
                        </Item>
                    ))}
                </ListCard>
            }
        >
            <Chip type="button" data-testid="agent-annotation-chip">
                <Quote size={12} />
                {t('chat.annotationCount', { count: entries.length })}
            </Chip>
        </Popover>
    )
}
