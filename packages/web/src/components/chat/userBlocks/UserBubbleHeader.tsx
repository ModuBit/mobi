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
import { Quote } from 'lucide-react'
import { Bot, User } from 'lucide-react'
import styled from '@emotion/styled'
import type { UserContentBlock, UserDocumentBlock, UserQuoteBlock } from '@mobi/shared'
import { groupUserBlocks } from '@/domain/chat/userContent'
import { quoteAnchorProps } from '@/domain/chat/quoteSelection'
import { truncatePreview } from '@/core/lib/truncatePreview'
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
 */

/** 列表卡单条目 excerpt 预览截断宽度（全文语义由定位跳转承载，不再靠 tooltip） */
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
    /* 恒定宽度（与 composer 引用列表卡同一量级）：短 excerpt 时 shrink-to-fit 卡片过窄；
       窄屏由 quote-list-popover 锁死几何接管（styles/antd.css），卡片满内容宽 */
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

/**
 * 引用 chip（气泡内收起形态）：点击展开只读列表卡，条目点击定位源消息。
 * 组是引用禁区（data-quote-forbidden + user-select:none）——「引用的引用」语义混乱，
 * 判定器的第二道防御随 chip 一起搬进 popover。
 */
function UserQuoteChip({ blocks, onLocate }: { blocks: UserQuoteBlock[]; onLocate?: (messageId: string) => void }) {
    const { t } = useTranslation()
    const { token } = theme.useToken()
    const [open, setOpen] = useState(false)
    const anchorProps = quoteAnchorProps({ forbidden: true })

    const list = (
        // 禁区锚点载体 display:contents（零盒标记层），真实滚动盒在 ListCard——
        // 锚点只做 DOM 爬取标记，不参与布局
        <div {...anchorProps} style={{ ...anchorProps.style, userSelect: 'none' }}>
            <ListCard data-testid="user-quote-list">
                {blocks.map((b, i) => {
                    const RoleIcon = b.role === 'user' ? User : Bot
                    return (
                        <Item
                            key={`${i}-${b.messageId}`}
                            $divided={i > 0}
                            data-testid={`user-quote-item-${i}`}
                            onClick={() => {
                                setOpen(false)
                                onLocate?.(b.messageId)
                            }}
                            style={{ cursor: onLocate ? 'pointer' : undefined }}
                        >
                            <ItemIndex>{i + 1}.</ItemIndex>
                            <RoleIcon size={12} style={{ flexShrink: 0, marginTop: 3, color: token.colorTextTertiary }} />
                            <span style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                                <ItemText>{truncatePreview(b.excerpt, ITEM_PREVIEW_MAX)}</ItemText>
                                {b.comment && <ItemComment>{b.comment}</ItemComment>}
                            </span>
                        </Item>
                    )
                })}
            </ListCard>
        </div>
    )

    return (
        <Popover content={list} trigger="click" placement="topLeft" overlayClassName="quote-list-popover" open={open} onOpenChange={setOpen}>
            <Chip type="button" data-testid="user-quote-chip">
                <Quote size={12} />
                {t('composer.quoteCount', { count: blocks.length })}
            </Chip>
        </Popover>
    )
}

/** 附件层容器：段间垂直间距对齐正文 UserBlocksView 的顶层 Space size */
export function UserBubbleHeader({ blocks, env }: { blocks: readonly UserContentBlock[]; env: UserBlockRenderEnv }) {
    const segs = groupUserBlocks(blocks).filter(seg => seg.kind !== 'block')
    if (segs.length === 0) return null

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
