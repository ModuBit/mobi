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

import { useRef, useEffect, useLayoutEffect, useMemo, useState, useCallback } from 'react'
import { Bubble } from '@ant-design/x'
import { Spin, Empty, Button, Skeleton, theme as antTheme } from 'antd'
import { DownOutlined } from '@ant-design/icons'
import { Global, css } from '@emotion/react'
import { useTranslation } from 'react-i18next'
import { useMessages } from '@/core/data/hooks/queries/useMessages'
import { useSession } from '@/core/data/hooks/queries/useSession'
import { useSendMessage } from '@/core/data/hooks/mutations/useSendMessage'
import { useSessionActions } from '@/core/data/hooks/mutations/useSessionActions'
import { reduceChatBlocks, normalizeDecryptedMessage } from '@/domain/chat'
import { formatMessageTime } from '@/core/utils/timeFormat'
import { buildChatBubbleItems, type BubbleItemBase } from './buildBubbleItems'
import { ChatComposer } from '@/components/composer/ChatComposer'
import { AgentLoadingBubble } from './AgentLoadingBubble'
import { CopyButton } from './CopyButton'
import { useAuthStore } from '@/core/data/stores/authStore'
import { useMobiApi } from '@/core/data/api/client'
import type { ActionItem } from '@/components/composer/ResponsiveActionBar'
import type { SessionMetadataSummary } from '@/core/data/api/types'

const { useToken } = antTheme

/** 用户消息气泡 hover 时显示 header 中的复制按钮 */
const bubbleCopyStyles = css`
    .user-msg-bubble .msg-copy-btn {
        opacity: 0;
        transition: opacity 0.15s ease;
    }
    .user-msg-bubble:hover .msg-copy-btn {
        opacity: 1;
    }
`

/** 滚动相关阈值（autoScroll=false，正常 flex column 布局） */
const HISTORY_PREFETCH_DISTANCE = 200
const AUTO_SCROLL_NEAR_BOTTOM_THRESHOLD = 50
const SCROLL_BOTTOM_VISIBLE_THRESHOLD = 60

import { BUBBLE_ROLES } from './bubbleRoles'

export { BUBBLE_ROLES }

interface ChatContainerProps {
    sessionId: string
    /** 传递给 ChatComposer 的额外按钮（已废弃，请使用 extraComposerItems） */
    extraComposerButtons?: React.ReactNode
    /** 传递给 ChatComposer 的额外操作项 */
    extraComposerItems?: ActionItem[]
}

export function ChatContainer({ sessionId, extraComposerButtons, extraComposerItems }: ChatContainerProps) {
    const {
        data: messages = [],
        isLoading: messagesLoading,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
    } = useMessages(sessionId)
    const { data: session } = useSession(sessionId)
    const sendMutation = useSendMessage(sessionId)
    const sessionActions = useSessionActions(sessionId)
    const scrollContainerRef = useRef<HTMLDivElement>(null)
    const scrollBoxRef = useRef<HTMLElement | null>(null)
    const isRestoringScrollRef = useRef(false)
    const prevShowRef = useRef(false)
    // 历史消息加载的滚动恢复状态
    const pendingRestoreRef = useRef<{
        scrollTop: number
        scrollHeight: number
        blocksLength: number
    } | null>(null)
    const [showScrollBottom, setShowScrollBottom] = useState(false)
    const { token } = useToken()
    const { t } = useTranslation()
    const { token: authToken } = useAuthStore()
    const api = useMobiApi(authToken)

    // 工具渲染所需的元数据
    const metadata = (session?.metadata ?? null) as SessionMetadataSummary | null

    // 使用 reduceChatBlocks 处理消息（包含 CLI 输出合并）
    const { blocks: rawBlocks } = useMemo(() => {
        const normalized = messages
            .map(normalizeDecryptedMessage)
            .filter((m): m is Exclude<typeof m, null> => m !== null)
        return reduceChatBlocks(normalized, session?.agentState)
    }, [messages, session?.agentState])

    // 保形渲染：当还有更多历史消息时，过滤掉不完整的 tool-call block（state === 'running'）
    const chatBlocks = useMemo(() => {
        if (!hasNextPage) return rawBlocks
        return rawBlocks.filter((block) => {
            if (block.kind !== 'tool-call') return true
            return block.tool.state !== 'running'
        })
    }, [rawBlocks, hasNextPage])

    // 用 ref 跟踪 chatBlocks 长度，供滚动 handler 读取
    const chatBlocksLengthRef = useRef(chatBlocks.length)
    chatBlocksLengthRef.current = chatBlocks.length

    // 缓存 Bubble.List 的实际滚动容器（useLayoutEffect 确保在滚动处理之前更新）
    useLayoutEffect(() => {
        const el = scrollContainerRef.current
        if (!el) return
        scrollBoxRef.current = el.querySelector('.ant-bubble-list-scroll-box') as HTMLElement | null
    }, [chatBlocks.length])

    // 用 ref 持有滚动监听所需的值，避免频繁 rebind
    const hasNextPageRef = useRef(hasNextPage)
    hasNextPageRef.current = hasNextPage
    const isFetchingNextPageRef = useRef(isFetchingNextPage)
    isFetchingNextPageRef.current = isFetchingNextPage
    const fetchNextPageRef = useRef(fetchNextPage)
    fetchNextPageRef.current = fetchNextPage

    // 监听滚动位置（autoScroll=false，正常 flex column）
    // 同时通过 ResizeObserver 实现流式输出自动跟随（替代 autoScroll）
    useEffect(() => {
        const scrollBox = scrollBoxRef.current
        if (!scrollBox) return
        const contentEl = scrollBox.querySelector('.ant-bubble-list-scroll-content') as HTMLElement | null

        let isNearBottom = true

        const handleScroll = () => {
            if (isRestoringScrollRef.current) return

            const { scrollTop, scrollHeight, clientHeight } = scrollBox
            const distanceToBottom = scrollHeight - scrollTop - clientHeight
            isNearBottom = distanceToBottom < AUTO_SCROLL_NEAR_BOTTOM_THRESHOLD

            const shouldShow = distanceToBottom > SCROLL_BOTTOM_VISIBLE_THRESHOLD
            if (shouldShow !== prevShowRef.current) {
                prevShowRef.current = shouldShow
                setShowScrollBottom(shouldShow)
            }

            // 距离顶部 200px 时预加载历史消息
            if (scrollTop < HISTORY_PREFETCH_DISTANCE && hasNextPageRef.current && !isFetchingNextPageRef.current) {
                pendingRestoreRef.current = {
                    scrollTop,
                    scrollHeight,
                    blocksLength: chatBlocksLengthRef.current,
                }
                isFetchingNextPageRef.current = true
                fetchNextPageRef.current()
            }
        }

        // ResizeObserver：流式输出内容增长时自动跟随（用户在底部附近才触发）
        let resizeObserver: ResizeObserver | null = null
        if (contentEl) {
            resizeObserver = new ResizeObserver(() => {
                if (isNearBottom && !isRestoringScrollRef.current) {
                    scrollBox.scrollTop = scrollBox.scrollHeight
                }
            })
            resizeObserver.observe(contentEl)
        }

        scrollBox.addEventListener('scroll', handleScroll, { passive: true })
        return () => {
            scrollBox.removeEventListener('scroll', handleScroll)
            resizeObserver?.disconnect()
        }
    }, [chatBlocks.length])

    // 历史消息加载时的滚动位置保持
    // 每次渲染检测 scrollHeight 变化并增量补偿，覆盖 Skeleton 出现/消失和内容加载
    useLayoutEffect(() => {
        const pending = pendingRestoreRef.current
        if (!pending) return
        const scrollBox = scrollBoxRef.current
        if (!scrollBox) return

        const delta = scrollBox.scrollHeight - pending.scrollHeight
        if (delta !== 0) {
            scrollBox.scrollTop = pending.scrollTop + delta
            pending.scrollTop = scrollBox.scrollTop
            pending.scrollHeight = scrollBox.scrollHeight
        }
        if (chatBlocks.length > pending.blocksLength || !isFetchingNextPage) {
            pendingRestoreRef.current = null
            isRestoringScrollRef.current = true
            setTimeout(() => { isRestoringScrollRef.current = false }, 100)
        }
    }, [chatBlocks.length, isFetchingNextPage])

    const handleScrollToBottom = useCallback(() => {
        const scrollBox = scrollBoxRef.current
        if (scrollBox) scrollBox.scrollTo({ top: scrollBox.scrollHeight, behavior: 'smooth' })
    }, [])

    // 首次加载消息时滚动到底部
    const initialScrollRef = useRef(true)
    useLayoutEffect(() => {
        if (initialScrollRef.current && chatBlocks.length > 0 && scrollBoxRef.current) {
            initialScrollRef.current = false
            scrollBoxRef.current.scrollTop = scrollBoxRef.current.scrollHeight
        }
    }, [chatBlocks.length])

    const decoratedItems = useMemo(() => {
        const baseItems = buildChatBubbleItems(
            chatBlocks,
            { metadata, isThinking: false, api, sessionId, disabled: sendMutation.isPending },
            !!session?.running,
            { contextResetLabel: t('chat.contextReset') },
        )

        return baseItems.map(item => {
            const block = item.block
            const isUserText = block?.kind === 'user-text'

            return {
                ...item,
                header: isUserText ? (
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        <div className="msg-copy-btn">
                            <CopyButton text={block && 'text' in block ? (block as { text: string }).text : ''} size={16} />
                        </div>
                    </div>
                ) : undefined,
                classNames: isUserText ? { root: 'user-msg-bubble' } : undefined,
                footer: isUserText && block ? (
                    <span style={{ fontSize: 11, opacity: 0.6 }}>{formatMessageTime(block.createdAt)}</span>
                ) : undefined,
                footerPlacement: 'outer-end' as const,
            }
        })
    }, [chatBlocks, session?.running, metadata, api, sessionId, sendMutation.isPending, t])

    // FIXME: 长列表性能优化 —— Bubble.List 没有虚拟滚动，消息量持续增长时 DOM 节点线性增加。
    // 当实际使用中出现滚动卡顿时，考虑：1) 渲染窗口控制 2) 引入 rc-virtual-list 虚拟滚动。
    // 详见 docs/pending.md #23。
    const bubbleItems = useMemo(() => {
        const items: Array<BubbleItemBase & {
            header?: React.ReactNode
            footer?: React.ReactNode
            footerPlacement?: 'inner-start' | 'inner-end' | 'outer-start' | 'outer-end'
            classNames?: { root?: string }
        }> = [
            ...(isFetchingNextPage
                ? [{
                    key: '__loading-skeleton__',
                    role: 'system' as const,
                    content: <Skeleton active avatar paragraph={{ rows: 2 }} />,
                }]
                : []),
            ...decoratedItems,
        ]

        if (session?.running) {
            items.push({
                key: '__loading__',
                role: 'assistant',
                content: <AgentLoadingBubble sessionId={sessionId} />,
                variant: 'borderless',
            })
        }

        return items
    }, [decoratedItems, isFetchingNextPage, session?.running, sessionId])

    const handleSend = (text: string) => {
        if (!text.trim()) return
        sendMutation.mutate(text)
    }

    const handleAbort = async () => {
        await sessionActions.abortSession()
    }

    const handleArchive = async () => {
        await sessionActions.archiveSession()
    }

    const handlePermissionModeChange = async (mode: string) => {
        await sessionActions.setPermissionMode(mode)
    }

    const handleModelChange = async (model: string | null) => {
        if (model) {
            await sessionActions.setModelMode(model)
        }
    }

    const handleEffortChange = async (effort: string) => {
        await sessionActions.setEffort(effort)
    }

    const agentFlavor = session?.metadata?.flavor ?? null

    if (messagesLoading) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
                <Spin description={t('common.loading')} />
            </div>
        )
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <Global styles={bubbleCopyStyles} />
            <div ref={scrollContainerRef} style={{ flex: 1, overflow: 'auto', padding: '8px 8px', fontFamily: 'var(--font-chat)', position: 'relative' }}>
                {chatBlocks.length === 0 ? (
                    <Empty description={t('chat.empty')} style={{ marginTop: 40 }} />
                ) : (
                    <>
                        {/* autoScroll=false：不使用 Bubble.List 的 autoScroll。
                          autoScroll 启用 column-reverse 布局和 useCompatibleScroll，
                          后者通过 ResizeObserver + enforceScrollLock 独立管理视口位置。
                          加载历史消息时，enforceScrollLock 与手动 scrollTop 恢复存在时序冲突，
                          且 shouldLock 在用户靠近哨兵时为 false 导致跳过锁定。
                          因此禁用 autoScroll，改用下方 ResizeObserver 自行实现流式跟随。 */}
                        <Bubble.List
                            items={bubbleItems}
                            role={BUBBLE_ROLES}
                            style={{ height: '100%' }}
                            autoScroll={false}
                        />
                    </>
                )}
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
                            bottom: 32,
                            transform: 'translateX(-50%)',
                            zIndex: 10,
                            boxShadow: token.boxShadowSecondary,
                            minWidth: 36,
                            minHeight: 36,
                        }}
                    />
                )}
            </div>

            <ChatComposer
                sessionId={sessionId}
                disabled={sendMutation.isPending}
                sending={sendMutation.isPending}
                permissionMode={session?.permissionMode}
                model={session?.runtimeState?.model}
                active={session?.active ?? false}
                allowSendWhenInactive={false}
                running={session?.running ?? false}
                agentState={session?.agentState}
                metadata={metadata}
                contextSize={undefined}
                agentFlavor={agentFlavor}
                mode={session?.mode}
                workingDir={session?.metadata?.path}
                effort={session?.runtimeState?.effort}
                onEffortChange={handleEffortChange}
                onPermissionModeChange={handlePermissionModeChange}
                onModelChange={handleModelChange}
                onSend={handleSend}
                onAbort={handleAbort}
                abortPending={sessionActions.isAbortPending}
                onArchive={handleArchive}
                archivePending={sessionActions.isArchivePending}
                onActivate={() => sessionActions.resumeSession()}
                activatePending={sessionActions.isResumePending}
                onSwitchToRemote={() => sessionActions.switchSession()}
                switchPending={sessionActions.isSwitchPending}
                extraLeftButtons={extraComposerButtons}
                extraItems={extraComposerItems}
            />
        </div>
    )
}
