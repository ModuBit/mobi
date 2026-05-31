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
import { Spin, Button, Skeleton, theme as antTheme, message } from 'antd'
import { DownOutlined } from '@ant-design/icons'
import { Global, css } from '@emotion/react'
import { useTranslation } from 'react-i18next'
import { useMessages } from '@/core/data/hooks/queries/useMessages'
import { useSession } from '@/core/data/hooks/queries/useSession'
import { useSendMessage } from '@/core/data/hooks/mutations/useSendMessage'
import { useSessionActions } from '@/core/data/hooks/mutations/useSessionActions'
import { reduceChatBlocks, normalizeDecryptedMessage, extractRunningAgents } from '@/domain/chat'
import { formatMessageTime } from '@/core/utils/timeFormat'
import { buildChatBubbleItems, type BubbleItemBase } from './buildBubbleItems'
import { ChatComposer } from '@/components/composer/ChatComposer'
import { AgentLoadingBubble } from './AgentLoadingBubble'
import { CompactProgressBubble } from './CompactProgressBubble'
import { ChatWelcome } from './ChatWelcome'
import { CopyButton } from './CopyButton'
import { useAuthStore } from '@/core/data/stores/authStore'
import { useMobiApi } from '@/core/data/api/client'
import type { ActionItem } from '@/components/composer/ResponsiveActionBar'
import type { SessionMetadataSummary } from '@/core/data/api/types'
import { getAgentStatus } from '@/components/pixel-avatar/types'
import { useRunningAgentsStore } from '@/core/data/stores/runningAgentsStore'
import { useBackgroundTasksStore } from '@/core/data/stores/backgroundTasksStore'
import { useChatBlocksByIdStore } from '@/core/data/stores/chatBlocksByIdStore'
import { useTeamAgentsStore } from '@/core/data/stores/teamAgentsStore'

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
const COMPACT_COMMAND = '/compact'

const HISTORY_PREFETCH_DISTANCE = 200
const AUTO_SCROLL_NEAR_BOTTOM_THRESHOLD = 50
const SCROLL_BOTTOM_VISIBLE_THRESHOLD = 60
// 补偿完成后屏蔽滚动事件的时间窗口（覆盖 ResizeObserver + rAF 双帧延迟）
const RESTORE_SCROLL_GUARD_MS = 100

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

    const metadata = (session?.metadata ?? null) as SessionMetadataSummary | null

    const { blocks: rawBlocks, byId } = useMemo(() => {
        const normalized = messages
            .map(normalizeDecryptedMessage)
            .filter((m): m is Exclude<typeof m, null> => m !== null)
        return reduceChatBlocks(normalized, session?.agentState)
    }, [messages, session?.agentState])

    // 同步 running agents 到 store，供 AgentPanel 订阅
    useEffect(() => {
        const agents = extractRunningAgents(rawBlocks)
        useRunningAgentsStore.getState().setAgents(sessionId, agents)
        return () => {
            useRunningAgentsStore.getState().clearSession(sessionId)
        }
    }, [rawBlocks, sessionId])

    // 同步 chatBlocks byId 到 store，供 ComposerInfoPanel 查找 block
    useEffect(() => {
        useChatBlocksByIdStore.getState().setById(sessionId, byId)
        return () => {
            useChatBlocksByIdStore.getState().clearSession(sessionId)
        }
    }, [byId, sessionId])

    // 同步 backgroundTasks 从 session cache 到 Zustand store，供 BackgroundTaskPanel 订阅
    const bgTasks = session?.runtimeState?.backgroundTasks
    useEffect(() => {
        if (bgTasks) {
            // BackgroundTaskItem.toolUseId 为 string|null|undefined，需要映射为 string|null
            const mapped = bgTasks.map(t => ({ ...t, toolUseId: t.toolUseId ?? null }))
            useBackgroundTasksStore.getState().setTasks(sessionId, mapped)
        } else {
            useBackgroundTasksStore.getState().setTasks(sessionId, [])
        }
        return () => {
            useBackgroundTasksStore.getState().clearSession(sessionId)
        }
    }, [bgTasks, sessionId])

    // 同步 teamState 从 session cache 到 Zustand store，供 TeamAgentPanel 订阅
    const teamState = session?.runtimeState?.teamState
    useEffect(() => {
        if (teamState) {
            useTeamAgentsStore.getState().setTeamState(
                sessionId,
                teamState.members ?? [],
                teamState.tasks ?? [],
                teamState.teamName ?? null,
            )
        } else {
            useTeamAgentsStore.getState().clearSession(sessionId)
        }
        return () => {
            useTeamAgentsStore.getState().clearSession(sessionId)
        }
    }, [teamState, sessionId])

    // 后台任务完成时显示 Toast 通知 + 收集完成卡片信息
    const [messageApi, contextHolder] = message.useMessage()
    const [bgCompletedTasks, setBgCompletedTasks] = useState<Array<{
        taskId: string; description: string; summary?: string; status: string; toolName: string
    }>>([])
    // sessionId 变化时清空，防止跨会话泄漏
    useEffect(() => { setBgCompletedTasks([]) }, [sessionId])
    useEffect(() => {
        const removed = useBackgroundTasksStore.getState().consumeRemoved()
        if (removed.length === 0) return
        const completed = removed
            .filter(t => t.status !== 'stopped')
            .map(t => ({
                taskId: t.taskId,
                description: t.description ?? 'Background task',
                summary: t.summary,
                status: t.status,
                toolName: t.toolName,
            }))
        for (const task of completed) {
            messageApi.open({
                type: task.status === 'failed' ? 'error' : 'success',
                content: t(
                    task.status === 'failed'
                        ? 'chat.backgroundTask.failed'
                        : 'chat.backgroundTask.completed',
                    { description: task.description },
                ),
                duration: 3,
            })
        }
        if (completed.length > 0) {
            setBgCompletedTasks(prev => [...prev, ...completed].slice(-50))
        }
    }, [bgTasks, messageApi, t])

    // 有更多历史页时，过滤掉不完整的 tool-call block 避免闪烁
    const chatBlocks = useMemo(() => {
        let blocks = hasNextPage
            ? rawBlocks.filter((block) => {
                if (block.kind !== 'tool-call') return true
                return block.tool.state !== 'running'
            })
            : rawBlocks
        // 追加后台任务完成卡片
        if (bgCompletedTasks.length > 0) {
            const lastCreatedAt = blocks.length > 0 ? blocks[blocks.length - 1].createdAt : Date.now()
            blocks = [...blocks, ...bgCompletedTasks.map((task, i) => ({
                kind: 'agent-event' as const,
                id: `bg-completed-${task.taskId}-${i}`,
                createdAt: lastCreatedAt + i + 1,
                event: {
                    type: 'bg-task-completed',
                    taskId: task.taskId,
                    status: task.status as 'completed' | 'failed' | 'stopped',
                    summary: task.summary,
                    description: task.description,
                    toolName: task.toolName,
                } as const,
                meta: undefined,
            }))]
        }
        return blocks
    }, [rawBlocks, hasNextPage, bgCompletedTasks])

    // 从 chatBlocks 推导压缩状态：最后一条 user-text 是 /compact 且后面没有 compact-summary
    const isCompressing = useMemo(() => {
        const start = Math.max(0, chatBlocks.length - 10)
        for (let i = chatBlocks.length - 1; i >= start; i--) {
            const block = chatBlocks[i]
            if (block.kind === 'compact-summary') return false
            if (block.kind === 'user-text') {
                return block.text.trim() === COMPACT_COMMAND
            }
        }
        return false
    }, [chatBlocks])

    const chatBlocksLengthRef = useRef(chatBlocks.length)
    chatBlocksLengthRef.current = chatBlocks.length

    useLayoutEffect(() => {
        const el = scrollContainerRef.current
        if (!el) return
        scrollBoxRef.current = el.querySelector('.ant-bubble-list-scroll-box') as HTMLElement | null
    }, [chatBlocks.length])

    const hasNextPageRef = useRef(hasNextPage)
    hasNextPageRef.current = hasNextPage
    const isFetchingNextPageRef = useRef(isFetchingNextPage)
    isFetchingNextPageRef.current = isFetchingNextPage
    const fetchNextPageRef = useRef(fetchNextPage)
    fetchNextPageRef.current = fetchNextPage

    useEffect(() => {
        const el = scrollContainerRef.current
        if (!el) return
        // 直接查询 DOM：子组件 useEffect 先于父组件 useEffect 运行，
        // 此时 Bubble.List 内部创建的滚动容器应当已就绪
        const scrollBox = el.querySelector('.ant-bubble-list-scroll-box') as HTMLElement | null
        if (!scrollBox) return
        scrollBoxRef.current = scrollBox
        const contentEl = scrollBox.querySelector('.ant-bubble-list-scroll-content') as HTMLElement | null

        let isNearBottom = true
        let prevScrollTop = scrollBox.scrollTop

        /** 触发加载上一页历史消息，并记录滚动位置用于恢复 */
        const triggerFetchNextPage = (scrollTop: number, scrollHeight: number) => {
            pendingRestoreRef.current = {
                scrollTop,
                scrollHeight,
                blocksLength: chatBlocksLengthRef.current,
            }
            isFetchingNextPageRef.current = true
            fetchNextPageRef.current()
        }

        /**
         * 内容未溢出时主动加载历史消息
         * 窗口足够高时消息列表无需滚动，scroll 事件永远不会触发，
         * 导致历史消息无法加载。需要在布局稳定后主动检查并触发加载。
         * 同时响应窗口尺寸变化：用户拉高窗口使内容不再溢出时自动继续加载。
         */
        const checkOverflowAndFetch = () => {
            if (!hasNextPageRef.current || isFetchingNextPageRef.current) return
            const { scrollHeight, clientHeight, scrollTop } = scrollBox
            if (scrollHeight <= clientHeight) {
                triggerFetchNextPage(scrollTop, scrollHeight)
            }
        }

        const handleScroll = () => {
            if (isRestoringScrollRef.current) return

            const { scrollTop, scrollHeight, clientHeight } = scrollBox
            const distanceToBottom = scrollHeight - scrollTop - clientHeight

            // 只在用户向上滚动（scrollTop 减小）时更新 isNearBottom，
            // 内容增长导致的 scrollTop 变化不应打破底部锁定
            if (scrollTop < prevScrollTop - 2) {
                isNearBottom = distanceToBottom < AUTO_SCROLL_NEAR_BOTTOM_THRESHOLD
            } else if (distanceToBottom < AUTO_SCROLL_NEAR_BOTTOM_THRESHOLD) {
                isNearBottom = true
            }
            prevScrollTop = scrollTop

            const shouldShow = distanceToBottom > SCROLL_BOTTOM_VISIBLE_THRESHOLD
            if (shouldShow !== prevShowRef.current) {
                prevShowRef.current = shouldShow
                setShowScrollBottom(shouldShow)
            }

            if (scrollTop < HISTORY_PREFETCH_DISTANCE && hasNextPageRef.current && !isFetchingNextPageRef.current) {
                triggerFetchNextPage(scrollTop, scrollHeight)
            }
        }

        const handleAutoScroll = () => {
            if (isNearBottom && !isRestoringScrollRef.current) {
                scrollBox.scrollTop = scrollBox.scrollHeight
            }
        }

        let resizeObserver: ResizeObserver | null = null
        if (contentEl) {
            resizeObserver = new ResizeObserver(handleAutoScroll)
            resizeObserver.observe(contentEl)
        }

        // 监听视口尺寸变化：内容跟随底部 + 窗口拉高时触发溢出检测
        const viewportObserver = new ResizeObserver(() => {
            handleAutoScroll()
            checkOverflowAndFetch()
        })
        viewportObserver.observe(scrollBox)

        // useLayoutEffect 的初始滚动可能在布局未稳定时执行，此处（paint 后）再次校正
        if (postPaintCorrectionRef.current && chatBlocksLengthRef.current > 0) {
            postPaintCorrectionRef.current = false
            scrollBox.scrollTop = scrollBox.scrollHeight
        }

        // 初始加载时检查溢出
        checkOverflowAndFetch()

        scrollBox.addEventListener('scroll', handleScroll, { passive: true })
        return () => {
            scrollBox.removeEventListener('scroll', handleScroll)
            resizeObserver?.disconnect()
            viewportObserver.disconnect()
        }
    // 依赖 chatBlocks.length：仅在 block 数量变化时重新绑定 scroll 监听和 ResizeObserver。
    // 内容增长（如流式输出追加文本）由 ResizeObserver 感知，无需 rebind。
    // scrollBox DOM 替换由上方 useLayoutEffect 负责更新 scrollBoxRef。
    }, [chatBlocks.length])

    useLayoutEffect(() => {
        const pending = pendingRestoreRef.current
        if (!pending) return
        const scrollBox = scrollBoxRef.current
        if (!scrollBox) return

        const delta = scrollBox.scrollHeight - pending.scrollHeight
        if (delta !== 0) {
            isRestoringScrollRef.current = true
            scrollBox.scrollTop = pending.scrollTop + delta
            pending.scrollTop = scrollBox.scrollTop
            pending.scrollHeight = scrollBox.scrollHeight
        }
        if (chatBlocks.length > pending.blocksLength || !isFetchingNextPage) {
            pendingRestoreRef.current = null
            isRestoringScrollRef.current = true
            setTimeout(() => { isRestoringScrollRef.current = false }, RESTORE_SCROLL_GUARD_MS)
        }
    }, [chatBlocks.length, isFetchingNextPage])

    const handleScrollToBottom = useCallback(() => {
        const scrollBox = scrollBoxRef.current
        if (scrollBox) scrollBox.scrollTo({ top: scrollBox.scrollHeight, behavior: 'smooth' })
    }, [])

    // 首次加载消息时滚动到底部（sessionId 变化时重置）
    const initialScrollRef = useRef(true)
    const postPaintCorrectionRef = useRef(false)
    useEffect(() => { initialScrollRef.current = true }, [sessionId])

    useLayoutEffect(() => {
        if (initialScrollRef.current && chatBlocks.length > 0 && scrollBoxRef.current) {
            initialScrollRef.current = false
            postPaintCorrectionRef.current = true
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

        if (isCompressing) {
            items.push({
                key: '__compressing__',
                role: 'assistant',
                content: <CompactProgressBubble />,
                variant: 'borderless',
            })
        } else if (session?.running) {
            const loadingStatus = getAgentStatus({
                active: session.active ?? false,
                running: session.running,
                agentState: session.agentState,
            })
            items.push({
                key: '__loading__',
                role: 'assistant',
                content: <AgentLoadingBubble agentId={sessionId} status={loadingStatus} />,
                variant: 'borderless',
            })
        }

        return items
    }, [decoratedItems, isFetchingNextPage, isCompressing, session?.running, session?.agentState?.requests, sessionId])

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
            {contextHolder}
            <Global styles={bubbleCopyStyles} />
            <div ref={scrollContainerRef} style={{ flex: 1, overflow: 'auto', padding: '8px 8px', fontFamily: 'var(--font-chat)', position: 'relative' }}>
                {chatBlocks.length === 0 ? (
                    <ChatWelcome sessionId={sessionId} />
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
                disabled={sendMutation.isPending || isCompressing}
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
                todos={session?.runtimeState?.todos}
                tasks={session?.runtimeState?.tasks}
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
