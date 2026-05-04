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

import { useRef, useEffect, useMemo, useState, useCallback } from 'react'
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
    const scrollTopBeforeFetch = useRef<number>(0)
    const [showScrollBottom, setShowScrollBottom] = useState(false)
    const { token } = useToken()
    const { t } = useTranslation()
    const { token: authToken } = useAuthStore()
    const api = useMobiApi(authToken)

    // 工具渲染所需的元数据
    const metadata = (session?.metadata ?? null) as SessionMetadataSummary | null

    // 使用 reduceChatBlocks 处理消息（包含 CLI 输出合并）
    const { blocks: rawBlocks, incompleteToolCallIds } = useMemo(() => {
        // 先标准化消息，然后归约为聊天块
        const normalized = messages
            .map(normalizeDecryptedMessage)
            .filter((m): m is Exclude<typeof m, null> => m !== null)
        return reduceChatBlocks(normalized, session?.agentState)
    }, [messages, session?.agentState])

    // 保形渲染：当还有更多历史消息时，过滤掉不完整的 tool-call block
    const chatBlocks = useMemo(() => {
        if (!hasNextPage) return rawBlocks
        return rawBlocks.filter((block) => {
            if (block.kind !== 'tool-call') return true
            return !incompleteToolCallIds.has(block.id)
        })
    }, [rawBlocks, hasNextPage, incompleteToolCallIds])

    // 缓存 Bubble.List 的实际滚动容器
    useEffect(() => {
        const el = scrollContainerRef.current
        if (!el) return
        scrollBoxRef.current = el.querySelector('.ant-bubble-list-scroll-box') as HTMLElement | null
    }, [chatBlocks.length])

    // 监听滚动位置，column-reverse 布局下 scrollTop 为负值表示已滚到上方
    useEffect(() => {
        const scrollBox = scrollBoxRef.current
        if (!scrollBox) return

        const handleScroll = () => {
            const scrollTop = scrollBox.scrollTop
            setShowScrollBottom(scrollTop < -20)

            // 距离顶部 200px 时预加载历史消息
            // column-reverse 布局下：scrollHeight + scrollTop - clientHeight 表示距离顶部的距离
            const scrollHeight = scrollBox.scrollHeight
            const clientHeight = scrollBox.clientHeight
            const distanceToTop = scrollHeight + scrollTop - clientHeight
            if (distanceToTop < 200 && hasNextPage && !isFetchingNextPage) {
                scrollTopBeforeFetch.current = scrollTop
                fetchNextPage()
            }
        }

        scrollBox.addEventListener('scroll', handleScroll, { passive: true })
        return () => scrollBox.removeEventListener('scroll', handleScroll)
    }, [hasNextPage, isFetchingNextPage, fetchNextPage])

    // 加载历史消息时记录滚动位置
    useEffect(() => {
        if (isFetchingNextPage) {
            scrollTopBeforeFetch.current = scrollBoxRef.current?.scrollTop ?? 0
        }
    }, [isFetchingNextPage])

    // 加载历史完成后恢复滚动位置
    useEffect(() => {
        if (!isFetchingNextPage && scrollBoxRef.current) {
            scrollBoxRef.current.scrollTop = scrollTopBeforeFetch.current
        }
    }, [isFetchingNextPage])

    // 新消息到达时自动滚动到底部（仅在用户已在底部附近时）
    useEffect(() => {
        const scrollBox = scrollBoxRef.current
        if (!scrollBox || isFetchingNextPage) return
        if (scrollBox.scrollTop > -50) {
            scrollBox.scrollTo({ top: 0, behavior: 'smooth' })
        }
    }, [chatBlocks.length, isFetchingNextPage])

    // 手动跳到底部
    const handleScrollToBottom = useCallback(() => {
        scrollBoxRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
    }, [])

    // FIXME: 长列表性能优化 —— Bubble.List 没有虚拟滚动，消息量持续增长时 DOM 节点线性增加。
    // 当实际使用中出现滚动卡顿时，考虑：1) 渲染窗口控制 2) 引入 rc-virtual-list 虚拟滚动。
    // 详见 docs/pending.md #23。
    const bubbleItems = useMemo(() => {
        const baseItems = buildChatBubbleItems(
            chatBlocks,
            { metadata, isThinking: false, api, sessionId, disabled: sendMutation.isPending },
            !!session?.running,
            { contextResetLabel: t('chat.contextReset') },
        )

        // 加载历史消息时在列表顶部插入 Skeleton
        if (isFetchingNextPage) {
            baseItems.unshift({
                key: '__loading-skeleton__',
                role: 'system',
                content: <Skeleton active avatar paragraph={{ rows: 2 }} />,
            })
        }

        const items: Array<BubbleItemBase & {
            header?: React.ReactNode
            footer?: React.ReactNode
            footerPlacement?: 'inner-start' | 'inner-end' | 'outer-start' | 'outer-end'
            classNames?: { root?: string }
        }> = baseItems.map(item => {
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

        // running 时在列表末尾追加 loading 气泡
        if (session?.running) {
            items.push({
                key: '__loading__',
                role: 'assistant',
                content: <AgentLoadingBubble sessionId={sessionId} />,
                variant: 'borderless',
            })
        }

        return items
    }, [chatBlocks, session?.running, metadata, api, sessionId, sendMutation.isPending, t, isFetchingNextPage])

    // 自动滚动到底部
    // 发送消息
    const handleSend = (text: string) => {
        if (!text.trim()) return
        sendMutation.mutate(text)
    }

    // 中断会话
    const handleAbort = async () => {
        await sessionActions.abortSession()
    }

    // 退出会话
    const handleArchive = async () => {
        await sessionActions.archiveSession()
    }

    // 权限模式变更
    const handlePermissionModeChange = async (mode: string) => {
        await sessionActions.setPermissionMode(mode)
    }

    // 模型变更
    const handleModelChange = async (model: string | null) => {
        if (model) {
            await sessionActions.setModelMode(model)
        }
    }

    const handleEffortChange = async (effort: string) => {
        await sessionActions.setEffort(effort)
    }

    // Agent 类型
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
            {/* 消息列表 */}
            <div ref={scrollContainerRef} style={{ flex: 1, overflow: 'auto', padding: '8px 8px', fontFamily: 'var(--font-chat)', position: 'relative' }}>
                {chatBlocks.length === 0 ? (
                    <Empty description={t('chat.empty')} style={{ marginTop: 40 }} />
                ) : (
                    <>
                        <Bubble.List
                            items={bubbleItems}
                            role={BUBBLE_ROLES}
                            style={{ height: '100%' }}
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

            {/* Composer 输入组件 */}
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
                contextSize={undefined} // TODO: 从消息中计算上下文大小
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
