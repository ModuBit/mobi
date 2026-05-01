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
import { theme as antTheme, Button } from 'antd'
import { DownOutlined } from '@ant-design/icons'
import { Bubble } from '@ant-design/x'
import { safeStringify } from '@mobi/shared'
import type { SessionMetadataSummary } from '@/core/data/api/types'
import type { ChatBlock, NormalizedMessage } from '@/domain/chat'
import { normalizeDecryptedMessage, reduceChatBlocks } from '@/domain/chat'
import { Markdown } from '@/components/ui/Markdown'
import { renderChatBlock, type ChatBlockContext } from '@/components/chat/blocks'
import { BUBBLE_ROLES } from '@/components/chat/ChatContainer'
import { useSidechainMessages } from '@/core/data/hooks/queries/useSidechainMessages'

const ASSISTANT_BLOCK_KINDS = new Set(['agent-text', 'agent-reasoning', 'tool-call', 'compact-summary'])

/** Agent 工具的 Drawer 内容：BubbleList 渲染 sidechain 对话 */
export function AgentDrawerContent({ block, metadata, sessionId }: {
    block: Extract<ChatBlock, { kind: 'tool-call' }>
    metadata: SessionMetadataSummary | null
    sessionId?: string
}) {
    const { token } = antTheme.useToken()
    const scrollRef = useRef<HTMLDivElement>(null)
    const [showScrollBottom, setShowScrollBottom] = useState(false)

    const tool = block.tool
    const hasChildren = block.children.length > 0

    // 实时会话 children 已有数据，历史会话从 API 补载
    const { data: sidechainMessages = [] } = useSidechainMessages(
        hasChildren ? null : (sessionId ?? null),
        hasChildren ? null : block.id,
    )

    const childrenBlocks = useMemo(() => {
        if (hasChildren) return block.children
        if (sidechainMessages.length === 0) return []

        const normalized = sidechainMessages
            .map((msg) => normalizeDecryptedMessage(msg))
            .filter((m): m is NormalizedMessage => m !== null)
        const { blocks } = reduceChatBlocks(normalized, null)
        return blocks
    }, [hasChildren, block.children, sidechainMessages])

    const bubbleItems = useMemo(() => {
        const ctx: ChatBlockContext = {
            metadata,
            isThinking: false,
            disableDrawer: true,
        }
        const items: Array<{
            key: string
            role: 'assistant' | 'user' | 'system' | 'divider'
            content: React.ReactNode
            variant?: 'borderless'
        }> = []

        for (const child of childrenBlocks) {
            const content = renderChatBlock(child, ctx)
            if (content === null) continue

            let role: 'assistant' | 'user' | 'system' = 'user'
            if (ASSISTANT_BLOCK_KINDS.has(child.kind)) {
                role = 'assistant'
            } else if (child.kind === 'agent-event') {
                role = 'system'
            }

            items.push({
                key: child.id,
                role,
                content,
                variant: (role === 'system' || role === 'assistant') ? 'borderless' : undefined,
            })
        }

        // Result 分隔线
        items.push({
            key: '__result-divider__',
            role: 'divider',
            content: 'Result',
        })

        // Result bubble
        if (tool.result !== undefined && tool.result !== null) {
            const resultText = typeof tool.result === 'string'
                ? tool.result
                : safeStringify(tool.result)
            items.push({
                key: '__result__',
                role: 'assistant',
                content: <Markdown content={resultText} />,
                variant: 'borderless',
            })
        }

        return items
    }, [childrenBlocks, tool.result, metadata])

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
            <div ref={scrollRef} style={{ height: '100%', overflow: 'auto' }}>
                <Bubble.List
                    items={bubbleItems}
                    role={BUBBLE_ROLES}
                    style={{ height: '100%' }}
                />
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
