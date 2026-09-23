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
import { Popover, Space, theme } from 'antd'
import { useTranslation } from 'react-i18next'
import { Bot, Quote, User } from 'lucide-react'
import styled from '@emotion/styled'
import type { UserContentBlock, UserDocumentBlock, UserQuoteBlock } from '@mobi/shared'
import { groupUserBlocks, splitUserBodyAndAttachments } from '@/domain/chat/userContent'
import { quoteAnchorProps } from '@/domain/chat/quoteSelection'
import { truncatePreview } from '@/core/lib/truncatePreview'
import {
    QuoteChip,
    QuoteItemComment,
    QuoteItemIndex,
    QuoteItemText,
    QuoteListBox,
    QUOTE_ITEM_PREVIEW_MAX,
} from './QuoteListCard'
import type { UserBlockRenderEnv } from './UserBlocksView'
import { DocumentView, UserImageGroupView } from './UserBlocksView'

/**
 * 用户气泡 header 的「附件层」：图片 / 文档 / 引用不再占气泡正文，统一收进 bubble
 * header（正文只剩 text）。分段复用 groupUserBlocks（wire 顺序 image → document →
 * quote → text 保证图片、文档、引用各自连续），跳过 text 段——text 归正文渲染
 * （UserBlocksView），本组件只消费非 text 段。
 *
 * 引用是特例：不展开为引用组大块，收起为「N 条引用」chip（与 composer 引用胶囊同
 * 形态同词汇），点击展开 popover 列表卡核对，条目点击定位源消息——展开态只在用户
 * 主动核对时占用空间，正文/引用的价值分离一眼可读。
 * 视觉词汇共享自 QuoteListCard（/simplify 收口：与 composer 列表卡同一规则）。
 */

/** 只读条目行：编号 + 角色 icon + excerpt 预览（截断共享常量）+ 可选评论行 */
const Row = styled.div<{ $clickable: boolean; $divided: boolean }>`
    display: flex;
    gap: 8px;
    align-items: flex-start;
    padding: 2px 4px;
    border-radius: 4px;
    cursor: ${({ $clickable }) => ($clickable ? 'pointer' : undefined)};
    transition: background 0.15s;
    &:hover {
        background: ${({ $clickable }) => ($clickable ? 'var(--ant-color-fill-quaternary)' : undefined)};
    }
    ${({ $divided }) => ($divided ? 'border-top: 1px solid var(--ant-color-border-quaternary);' : '')}
`

function ReadonlyQuoteItem({ quote, index, divided, onClick, testId }: {
    quote: UserQuoteBlock
    index: number
    divided: boolean
    onClick?: () => void
    testId: string
}) {
    const { token } = theme.useToken()
    const RoleIcon = quote.role === 'user' ? User : Bot
    return (
        <Row $clickable={!!onClick} $divided={divided} data-testid={testId} onClick={onClick}>
            <QuoteItemIndex>{index + 1}.</QuoteItemIndex>
            <RoleIcon size={12} style={{ flexShrink: 0, marginTop: 3, color: token.colorTextTertiary }} />
            <span style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <QuoteItemText>{truncatePreview(quote.excerpt, QUOTE_ITEM_PREVIEW_MAX)}</QuoteItemText>
                {quote.comment && <QuoteItemComment>{quote.comment}</QuoteItemComment>}
            </span>
        </Row>
    )
}

/**
 * 引用 chip（气泡内收起形态）：点击展开只读列表卡，条目点击定位源消息。
 * 组是引用禁区（data-quote-forbidden + user-select:none）——「引用的引用」语义混乱，
 * 判定器的第二道防御随 chip 一起搬进 popover。
 */
function UserQuoteChip({ blocks, onLocate }: { blocks: UserQuoteBlock[]; onLocate?: (messageId: string) => void }) {
    const { t } = useTranslation()
    const [open, setOpen] = useState(false)
    const anchorProps = quoteAnchorProps({ forbidden: true })

    const list = (
        // 禁区锚点载体 display:contents（零盒标记层），真实滚动盒在 QuoteListBox——
        // 锚点只做 DOM 爬取标记，不参与布局
        <div {...anchorProps}>
            <QuoteListBox data-testid="user-quote-list">
                {blocks.map((b, i) => (
                    <ReadonlyQuoteItem
                        key={`${i}-${b.messageId}`}
                        quote={b}
                        index={i}
                        divided={i > 0}
                        testId={`user-quote-item-${i}`}
                        onClick={onLocate
                            ? () => {
                                setOpen(false)
                                onLocate?.(b.messageId)
                            }
                            : undefined}
                    />
                ))}
            </QuoteListBox>
        </div>
    )

    return (
        <Popover content={list} trigger="click" placement="topLeft" overlayClassName="quote-list-popover" open={open} onOpenChange={setOpen}>
            <QuoteChip type="button" data-testid="user-quote-chip">
                <Quote size={12} />
                {t('composer.quoteCount', { count: blocks.length })}
            </QuoteChip>
        </Popover>
    )
}

/** 附件层容器：段间垂直间距对齐正文 UserBlocksView 的顶层 Space size */
export function UserBubbleHeader({ blocks, env }: { blocks: readonly UserContentBlock[]; env: UserBlockRenderEnv }) {
    // 拆分单源：先确认存在附件层内容再跑分段（纯 text 消息零开销早退）
    if (!splitUserBodyAndAttachments(blocks).hasAttachments) return null
    const segs = groupUserBlocks(blocks).filter(seg => seg.kind !== 'block')

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
            {segs.map(seg => {
                if (seg.kind === 'documents') {
                    return (
                        <Space key={`docs-${seg.blocks[0].id}`} size={8} wrap style={{ maxWidth: '100%' }}>
                            {seg.blocks.map((d: UserDocumentBlock) => <DocumentView key={d.id} block={d} env={env} />)}
                        </Space>
                    )
                }
                if (seg.kind === 'images') {
                    // 组预览：多图放大后可直接上一张/下一张（含草图编辑入口平移）
                    return <UserImageGroupView key={`imgs-${seg.blocks[0].id}`} blocks={seg.blocks} env={env} />
                }
                return <UserQuoteChip key={`quotes-${seg.blocks[0].messageId}`} blocks={seg.blocks} onLocate={env.onQuoteLocate} />
            })}
        </div>
    )
}
