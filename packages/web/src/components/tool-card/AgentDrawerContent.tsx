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

import { useMemo, useRef, useState, useCallback, useEffect } from 'react'
import { theme as antTheme, Button, Skeleton } from 'antd'
import { DownOutlined } from '@ant-design/icons'
import { Bubble } from '@ant-design/x'
import { Global, css } from '@emotion/react'
import { useTranslation } from 'react-i18next'
import { isObject, safeStringify } from '@mobi/shared'
import type { SessionMetadataSummary } from '@/core/data/api/types'
import type { ChatBlock } from '@/domain/chat'
import { Markdown } from '@/components/ui/Markdown'
import { buildChatBubbleItems } from '@/components/chat/buildBubbleItems'
import { BUBBLE_ROLES } from '@/components/chat/bubbleRoles'
import { useAgentSidechain } from './useAgentSidechain'
import { extractTextFromResult } from '@/components/tool-card/views/_results'
import { AgentLoadingBubble } from '@/components/chat/AgentLoadingBubble'
import { isTeamAgentTool } from './knownTools'

/** Drawer 场景下覆盖全局 CSS 对 Bubble.List 的副作用 */
const drawerBubbleStyles = css`
    .drawer-chat-bubbles .ant-bubble-end:not(.ant-bubble-divider):not(.ant-bubble-system) {
        padding-inline-start: 0 !important;
    }
    .drawer-chat-bubbles .ant-bubble-end .ant-bubble-content-borderless {
        padding: 6px 10px !important;
    }
    .drawer-chat-bubbles .ant-bubble-start:not(.ant-bubble-divider):not(.ant-bubble-system) {
        padding-inline-end: 0 !important;
    }
`

/** Drawer 场景下的 Bubble.List role 配置 */
const DRAWER_BUBBLE_ROLES = {
    ...BUBBLE_ROLES,
    user: {
        placement: 'end' as const,
        variant: 'borderless' as const,
        styles: { content: { background: 'var(--ant-color-bg-text-hover)', padding: '6px 10px', borderRadius: 6 } },
    },
    divider: {
        variant: 'borderless' as const,
        styles: { content: { paddingBlock: 0, minHeight: 'auto' } },
    },
}

/** Sidechain 消息加载骨架屏 */
function SidechainSkeleton() {
    return (
        <div style={{ padding: '16px 8px' }}>
            <Skeleton active avatar paragraph={{ rows: 2 }} />
            <div style={{ marginTop: 16 }}>
                <Skeleton active avatar={{ style: { marginLeft: 'auto' } }} paragraph={{ rows: 2 }} />
            </div>
            <div style={{ marginTop: 16 }}>
                <Skeleton active avatar paragraph={{ rows: 1 }} />
            </div>
        </div>
    )
}

/** Agent 工具的 Drawer 内容：BubbleList 渲染 sidechain 对话 */
export function AgentDrawerContent({ block, metadata, sessionId }: {
    block: Extract<ChatBlock, { kind: 'tool-call' }>
    metadata: SessionMetadataSummary | null
    sessionId?: string
}) {
    const { token } = antTheme.useToken()
    const { t } = useTranslation()
    const scrollRef = useRef<HTMLDivElement>(null)
    const [showScrollBottom, setShowScrollBottom] = useState(false)

    const tool = block.tool

    // 两条数据路径封装在 hook 中：SSE 实时（block.children）/ API 历史（sidechain-messages）
    const { blocks: childrenBlocks, isLoading: showSkeleton } = useAgentSidechain(block, sessionId)

    const isRunning = tool.state === 'running' || tool.state === 'pending'

    // team agent 使用 input.name 作为 agent 标识，与 TeamAgentCard 保持一致
    const agentAvatarName = isTeamAgentTool(tool.name, tool.input) && isObject(tool.input) && typeof tool.input.name === 'string'
        ? tool.input.name : tool.id

    const bubbleItems = useMemo(() => {
        const baseItems = buildChatBubbleItems(
            childrenBlocks,
            { metadata, isThinking: false, disableDrawer: true },
            isRunning,
            { contextResetLabel: t('chat.contextReset'), rewoundToHereLabel: t('chat.rewind.rewoundToHere'), skippedLinksLabel: t('chat.rewind.skippedLinks') },
        )

        const items = [...baseItems]

        // agent 运行期间追加 loading 消息，使用子 agent 的 pixelavatar
        if (isRunning) {
            items.push({
                key: '__loading__',
                role: 'assistant',
                content: <AgentLoadingBubble agentId={agentAvatarName} status="outputting" startedAt={tool.startedAt ?? tool.createdAt} />,
                variant: 'borderless',
            })
        }

        if (tool.result !== undefined && tool.result !== null) {
            items.push({
                key: '__result-divider__',
                role: 'divider',
                content: (
                    <span style={{ fontSize: 11, color: token.colorTextTertiary, letterSpacing: 0.5 }}>
                        {t('chat.tool.result')}
                    </span>
                ),
            })
            const resultText = extractTextFromResult(tool.result) ?? safeStringify(tool.result)
            items.push({
                key: '__result__',
                role: 'assistant',
                content: <Markdown content={resultText} />,
                variant: 'borderless',
            })
        }

        return items
    }, [childrenBlocks, tool.result, tool.state, metadata, token.colorTextTertiary, agentAvatarName, tool.startedAt, tool.createdAt, t])

    // 新消息到来时滚动到最新位置
    useEffect(() => {
        const scrollBox = scrollRef.current
        if (!scrollBox) return
        scrollBox.scrollTo({ top: 0, behavior: 'smooth' })
    }, [childrenBlocks.length])

    useEffect(() => {
        const scrollBox = scrollRef.current
        if (!scrollBox) return
        const handleScroll = () => {
            setShowScrollBottom(scrollBox.scrollTop < -20)
        }
        scrollBox.addEventListener('scroll', handleScroll, { passive: true })
        return () => scrollBox.removeEventListener('scroll', handleScroll)
    }, [])

    const handleScrollToBottom = useCallback(() => {
        scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
    }, [])

    return (
        <div style={{ position: 'relative', height: '100%' }}>
            <Global styles={drawerBubbleStyles} />
            <div ref={scrollRef} style={{ height: '100%', overflow: 'auto', padding: '0 8px' }}>
                {showSkeleton ? (
                    <SidechainSkeleton />
                ) : (
                    <Bubble.List
                        className="drawer-chat-bubbles"
                        items={bubbleItems}
                        role={DRAWER_BUBBLE_ROLES}
                        styles={{
                            bubble: { paddingBlock: '2px' },
                        }}
                        style={{ height: '100%' }}
                    />
                )}
            </div>
            {showScrollBottom && (
                <Button
                    type="default"
                    shape="circle"
                    size="middle"
                    icon={<DownOutlined />}
                    onClick={handleScrollToBottom}
                    style={{
                        position: 'absolute',
                        left: '50%',
                        bottom: 16,
                        transform: 'translateX(-50%)',
                        zIndex: 10,
                        boxShadow: token.boxShadowSecondary,
                        minWidth: 36,
                        minHeight: 36,
                    }}
                />
            )}
        </div>
    )
}
