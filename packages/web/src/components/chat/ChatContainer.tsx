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
import { DownOutlined, LoadingOutlined, CompressOutlined, ClearOutlined } from '@ant-design/icons'
import { Global, css } from '@emotion/react'
import { useTranslation } from 'react-i18next'
import { useMessages } from '@/core/data/hooks/queries/useMessages'
import { useSession } from '@/core/data/hooks/queries/useSession'
import { useSendMessage } from '@/core/data/hooks/mutations/useSendMessage'
import { useSessionActions } from '@/core/data/hooks/mutations/useSessionActions'
import { isQueuedInMobi } from '@/core/lib/messages'
import { reduceChatBlocks, normalizeDecryptedMessage, extractRunningAgents, reconcileChatBlocks, type ChatBlocksById } from '@/domain/chat'
import { formatMessageTime } from '@/core/utils/timeFormat'
import { buildChatBubbleItems, type BubbleItemBase } from './buildBubbleItems'
import { ChatComposer, type ChatComposerHandle } from '@/components/composer/ChatComposer'
import { CommandProgressBubble } from './CommandProgressBubble'
import { isCommandInProgress, isClearInProgress, isCompactCompletion, COMPACT_COMMAND } from '@/domain/chat/presentation'
import { ChatWelcome } from './ChatWelcome'
import { CopyButton } from './CopyButton'
import { QueuedMessagesBar } from './QueuedMessagesBar'
import { useMobiApi } from '@/core/data/api/client'
import type { ActionItem } from '@/components/composer/ResponsiveActionBar'
import type { SessionMetadataSummary } from '@/core/data/api/types'
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

/** 聊天内容区最大宽度：超宽屏时限宽居中，避免用户/AI 气泡分列两端过于割裂；小屏自动 100% */
const CHAT_MAX_WIDTH = 1200

const HISTORY_PREFETCH_DISTANCE = 200
const AUTO_SCROLL_NEAR_BOTTOM_THRESHOLD = 50
const SCROLL_BOTTOM_VISIBLE_THRESHOLD = 60
// 补偿完成后屏蔽滚动事件的时间窗口（覆盖 ResizeObserver + rAF 双帧延迟）
const RESTORE_SCROLL_GUARD_MS = 100
/** 流式跟随平滑滚动：每帧靠近目标的比例（0~1，越大收敛越快、越生硬） */
const SMOOTH_FOLLOW_FACTOR = 0.25
/**
 * 瞬时贴底阈值（px）：gap ≤ 此值时直接对齐，不走 glide。
 * 逐字 reveal 的单次增量（~10–40px）落在此范围内 → 每次瞬时贴底，gap 始终≈0，
 * 底部最新气泡不会被"推下再追回"地上下浮动。
 * 而 20fps × ~20px 的小步进视觉上本身就是平滑的（等价于正常滚动速度）。
 * 也是 glide 区间的下限：只有 gap ∈ (此值, SNAP] 才平滑滚动。
 */
const SMOOTH_FOLLOW_INSTANT_THRESHOLD = 80
/** 平滑跟随最大差距：超过则直接对齐，避免大块内容（代码块/图片）出现时长时间滑不到底 */
const SMOOTH_FOLLOW_SNAP_THRESHOLD = 300

import { BUBBLE_ROLES } from './bubbleRoles'
import { collapsibleUserMessageStyles } from './CollapsibleUserMessage'

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
    const sendMutation = useSendMessage(sessionId, session?.running ?? false)
    const sessionActions = useSessionActions(sessionId)
    const scrollContainerRef = useRef<HTMLDivElement>(null)
    const scrollBoxRef = useRef<HTMLElement | null>(null)
    const composerRef = useRef<ChatComposerHandle>(null)
    const isRestoringScrollRef = useRef(false)
    const prevShowRef = useRef(false)
    const pendingRestoreRef = useRef<{
        scrollTop: number
        scrollHeight: number
        blocksLength: number
    } | null>(null)
    const [showScrollBottom, setShowScrollBottom] = useState(false)
    // fill 级联模式：初始加载连续加载多页 beforeSeq，期间不做 scroll 补偿、不显示 skeleton
    const isFillingRef = useRef(false)
    // observer 绑定标记：避免 chatBlocks.length 变化时重复绑定
    const setupDoneRef = useRef(false)
    // observer 清理函数：不通过 effect cleanup 返回，由 session effect 统一管理
    const observerCleanupRef = useRef<(() => void) | null>(null)
    // scroll restoration setTimeout ID，用于 session 切换/unmount 时清理
    const scrollRestoreTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    // reconcile 结构化共享：维护前一帧 byId，让未变化的 block 保持引用稳定
    const prevByIdRef = useRef<ChatBlocksById>(new Map())
    // 触发历史消息加载的函数引用（observer setup effect 中赋值）
    const triggerFetchRef = useRef<(scrollTop: number, scrollHeight: number) => void>(() => {})
    const { token } = useToken()
    const { t } = useTranslation()
    const api = useMobiApi()

    const metadata = (session?.metadata ?? null) as SessionMetadataSummary | null

    const { blocks: rawBlocks, byId } = useMemo(() => {
        // 排队消息仅在悬浮条展示，不进入聊天线程
        const visibleMessages = messages.filter(m => !isQueuedInMobi(m))
        const normalized = visibleMessages
            .map(normalizeDecryptedMessage)
            .filter((m): m is Exclude<typeof m, null> => m !== null)
        const raw = reduceChatBlocks(normalized, session?.agentState)
        // 结构化共享：未变化的 block 返回旧引用 → React.memo 生效
        const { blocks, byId } = reconcileChatBlocks(raw.blocks, prevByIdRef.current)
        prevByIdRef.current = byId
        return { ...raw, blocks, byId }
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

    // 从 chatBlocks 推导压缩状态：完成标志见 isCompactCompletion（compact-summary 成功路径 + compact-completed 失败兜底）
    const isCompressing = useMemo(
        () => isCommandInProgress(chatBlocks, COMPACT_COMMAND, isCompactCompletion),
        [chatBlocks]
    )

    // /clear 进行中：禁用输入，防止 clear 期间提交新消息（与 isCompressing 共用 isCommandInProgress）
    const isClearing = useMemo(() => isClearInProgress(chatBlocks), [chatBlocks])

    // clear 完成事件（context-cleared）丢失兜底：发送完成 10s 后若仍卡在 clear，强制解禁，
    // 避免输入永久禁用。compact 不加此兜底——其可合法耗时数十秒，超时会误判进行中为卡死。
    const [clearStuck, setClearStuck] = useState(false)
    useEffect(() => {
        setClearStuck(false)
        if (!isClearing || sendMutation.isPending) return
        const timer = setTimeout(() => setClearStuck(true), 10_000)
        return () => clearTimeout(timer)
    }, [isClearing, sendMutation.isPending])

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

    // session 切换时重置 observer 绑定状态并清理
    useEffect(() => {
        setupDoneRef.current = false
        isFillingRef.current = false
        prevByIdRef.current = new Map()
        observerCleanupRef.current?.()
        observerCleanupRef.current = null
        if (scrollRestoreTimerRef.current) {
            clearTimeout(scrollRestoreTimerRef.current)
            scrollRestoreTimerRef.current = null
        }
        return () => {
            observerCleanupRef.current?.()
            observerCleanupRef.current = null
            if (scrollRestoreTimerRef.current) {
                clearTimeout(scrollRestoreTimerRef.current)
                scrollRestoreTimerRef.current = null
            }
        }
    }, [sessionId])

    // Observer 绑定 — setupDoneRef 确保只绑定一次，不随 chatBlocks.length 重复 teardown/rebuild
    useEffect(() => {
        if (setupDoneRef.current) return

        const el = scrollContainerRef.current
        if (!el) return
        const scrollBox = el.querySelector('.ant-bubble-list-scroll-box') as HTMLElement | null
        if (!scrollBox) return

        setupDoneRef.current = true
        scrollBoxRef.current = scrollBox
        const contentEl = scrollBox.querySelector('.ant-bubble-list-scroll-content') as HTMLElement | null

        let isNearBottom = true
        let prevScrollTop = scrollBox.scrollTop
        let rafId = 0
        // 流式跟随的平滑滚动 rAF id（独立于 ResizeObserver 防抖用的 rafId）
        let smoothFollowRafId = 0
        // 平滑跟随的目标 scrollTop（= scrollHeight - clientHeight，即可达底部）。
        // 由 captureFollowTarget 在内容/视口尺寸变化时刷新，tick 只读这个闭包变量，
        // 不每帧读 scrollHeight/clientHeight（避免 rAF 内触发强制同步 layout）。
        let followMaxTop = scrollBox.scrollHeight - scrollBox.clientHeight
        // tick 内对 scrollTop 的镜像：每次写入后同步更新，使 tick 无需读 scrollBox.scrollTop。
        // 仅在 loop 拥有滚动权期间有效（用户主动滚动会取消 loop，下次启动重新读取实际值）。
        let currentPos = scrollBox.scrollTop

        /** 触发加载上一页历史消息 */
        const triggerFetchNextPage = (scrollTop: number, scrollHeight: number) => {
            if (!isFillingRef.current) {
                // 用户主动加载历史：设置 pendingRestoreRef 保持 scroll 位置
                pendingRestoreRef.current = {
                    scrollTop,
                    scrollHeight,
                    blocksLength: chatBlocksLengthRef.current,
                }
            }
            // fill 模式下不设置 pendingRestoreRef，不做 scroll 补偿
            isFetchingNextPageRef.current = true
            fetchNextPageRef.current()
        }
        // 保存到 ref，供 auto-chain（scroll restoration useLayoutEffect）调用
        triggerFetchRef.current = triggerFetchNextPage

        /**
         * 内容未溢出时主动加载历史消息
         * 窗口足够高时消息列表无需滚动，scroll 事件永远不会触发，
         * 导致历史消息无法加载。需要在布局稳定后主动检查并触发加载。
         */
        const checkOverflowAndFetch = () => {
            if (!hasNextPageRef.current || isFetchingNextPageRef.current) return
            const { scrollHeight, clientHeight, scrollTop } = scrollBox
            if (scrollHeight <= clientHeight) {
                // 内容未溢出 → 进入 fill 模式，加载更多
                isFillingRef.current = true
                triggerFetchNextPage(scrollTop, scrollHeight)
            } else if (isFillingRef.current) {
                // Fill 期间内容已溢出，滚到底部
                // 不立即重置 isFillingRef，由 fill cascade effect 在 fetch 完成后统一重置
                // 避免 isFillingRef=false + isFetchingNextPage=true 的缝隙导致 skeleton 闪烁
                scrollBox.scrollTop = scrollBox.scrollHeight
            }
        }

        const handleScroll = () => {
            if (isRestoringScrollRef.current) return

            const { scrollTop, scrollHeight, clientHeight } = scrollBox
            const distanceToBottom = scrollHeight - scrollTop - clientHeight

            if (scrollTop < prevScrollTop - 2) {
                // 用户主动向上滚 → 立即终止平滑跟随，避免下一帧把位置又拉回底部
                cancelAnimationFrame(smoothFollowRafId)
                smoothFollowRafId = 0
                isNearBottom = distanceToBottom < AUTO_SCROLL_NEAR_BOTTOM_THRESHOLD
            } else if (distanceToBottom < AUTO_SCROLL_NEAR_BOTTOM_THRESHOLD) {
                isNearBottom = true
            }
            prevScrollTop = scrollTop

            // 跟随期间（isNearBottom）强制不显示「滚到底」按钮：
            // 平滑 glide 时 distanceToBottom 可能瞬时超过阈值，不加此闸会导致按钮快速闪烁
            const shouldShow = !isNearBottom && distanceToBottom > SCROLL_BOTTOM_VISIBLE_THRESHOLD
            if (shouldShow !== prevShowRef.current) {
                prevShowRef.current = shouldShow
                setShowScrollBottom(shouldShow)
            }

            if (scrollTop < HISTORY_PREFETCH_DISTANCE && hasNextPageRef.current && !isFetchingNextPageRef.current) {
                // 用户主动滚动到顶部加载历史
                isFillingRef.current = false
                triggerFetchNextPage(scrollTop, scrollHeight)
            }
        }

        const handleAutoScroll = () => {
            // fill 级联期间不做 scroll 补偿
            if (isFillingRef.current) return
            if (isNearBottom && !isRestoringScrollRef.current) {
                smoothFollowToBottom()
            }
        }

        /**
         * 刷新平滑跟随目标（内容/视口尺寸变化时调用）。
         * 目标是 scrollHeight - clientHeight——即 scrollTop 的物理上限（可达底部），
         * 而非 scrollHeight（不可达，会被浏览器钳制）。集中在此读取 layout 属性，
         * 让 tick 无需每帧触发同步 layout。
         */
        const captureFollowTarget = () => {
            followMaxTop = scrollBox.scrollHeight - scrollBox.clientHeight
        }

        /**
         * 平滑跟随到底部：rAF 循环每帧按 SMOOTH_FOLLOW_FACTOR 逼近 followMaxTop。
         * 用比例逼近替代「每帧硬切 scrollTop = scrollHeight」，消除快速输出时
         * 每帧瞬移累积的跳动。tick 只读写镜像 currentPos（不读 layout 属性），
         * layout 由 captureFollowTarget 在尺寸变化时统一捕获，内容持续长高也能追踪。
         * 终止：追到底 / 用户向上滚（isNearBottom=false）/ 恢复滚动中 / 差距过大直接对齐。
         */
        const smoothFollowToBottom = () => {
            if (smoothFollowRafId) return
            captureFollowTarget()
            currentPos = scrollBox.scrollTop
            // 已贴近底部（含内容未溢出 followMaxTop≤0 / 逐字 reveal 小增量）→ 瞬时对齐，不启动循环
            if (currentPos >= followMaxTop - SMOOTH_FOLLOW_INSTANT_THRESHOLD) {
                if (scrollBox.scrollTop !== followMaxTop) scrollBox.scrollTop = followMaxTop
                return
            }
            const tick = () => {
                // 期间用户主动向上滚 / 进入 scroll 恢复 → 终止。
                // 不检查 isFillingRef：fill（向上加载历史）几乎只在初始加载期发生，
                // 那时无流式 glide 在跑；且 fill 与 glide 都朝底部推，不冲突
                if (!isNearBottom || isRestoringScrollRef.current) {
                    smoothFollowRafId = 0
                    return
                }
                const remaining = followMaxTop - currentPos
                // 贴近底部（含逐字 reveal 的小增量）/ 内容收缩 / 超大突变 → 瞬时贴底。
                // 小增量若走 glide，25%/帧追不上 20fps 的持续 reveal，滞后累积会把
                // 底部最新气泡推下再追回 → 上下浮动。瞬时对齐保持 gap≈0 既无浮动，
                // 步进又足够小，视觉上仍平滑。
                if (remaining <= SMOOTH_FOLLOW_INSTANT_THRESHOLD || remaining > SMOOTH_FOLLOW_SNAP_THRESHOLD) {
                    scrollBox.scrollTop = followMaxTop
                    currentPos = followMaxTop
                    smoothFollowRafId = 0
                    return
                }
                // 中等增量（典型快速 burst / 代码块撑高）→ 平滑 glide，消除硬切跳动。
                // remaining > INSTANT_THRESHOLD(80)，故步进 = remaining*0.25 > 20，无需下限兜底；
                // Math.min 防御 followMaxTop 在 tick 间收缩的越界（正常不触发）
                currentPos = Math.min(currentPos + remaining * SMOOTH_FOLLOW_FACTOR, followMaxTop)
                scrollBox.scrollTop = currentPos
                smoothFollowRafId = requestAnimationFrame(tick)
            }
            smoothFollowRafId = requestAnimationFrame(tick)
        }

        // contentEl ResizeObserver：RAF 防抖，防止 thinking 动画每帧触发微抖
        // 只处理 autoScroll，不调用 checkOverflowAndFetch（fill 级联由专属 effect 驱动）
        let resizeObserver: ResizeObserver | null = null
        if (contentEl) {
            resizeObserver = new ResizeObserver(() => {
                cancelAnimationFrame(rafId)
                rafId = requestAnimationFrame(() => {
                    // 内容长高 → 先刷新目标，再跟随（loop 运行中则 tick 内自动用新目标）
                    captureFollowTarget()
                    handleAutoScroll()
                })
            })
            resizeObserver.observe(contentEl)
        }

        // 监听视口尺寸变化：autoScroll + 窗口拉高时检测溢出继续加载历史
        const viewportObserver = new ResizeObserver(() => {
            // 视口变化改变 clientHeight → 可达底部随之变化，刷新目标
            captureFollowTarget()
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

        // 不返回 cleanup！保存到 ref，由 session effect 统一清理
        observerCleanupRef.current = () => {
            scrollBox.removeEventListener('scroll', handleScroll)
            resizeObserver?.disconnect()
            viewportObserver.disconnect()
            cancelAnimationFrame(rafId)
            cancelAnimationFrame(smoothFollowRafId)
            smoothFollowRafId = 0
        }
    }, [chatBlocks.length])

    // fill 级联驱动：只在 isFillingRef 已为 true 时继续加载（初始 fill 由 observer setup 启动）
    // 用户手动滚到顶部加载历史时 isFillingRef 为 false，级联不会接管
    useEffect(() => {
        const scrollBox = scrollBoxRef.current
        if (!scrollBox) return
        if (!isFillingRef.current) return
        if (!hasNextPageRef.current || isFetchingNextPageRef.current) return

        const { scrollHeight, clientHeight } = scrollBox
        if (scrollHeight <= clientHeight) {
            isFetchingNextPageRef.current = true
            fetchNextPageRef.current()
        } else {
            isFillingRef.current = false
            scrollBox.scrollTop = scrollBox.scrollHeight
        }
    }, [chatBlocks.length, isFetchingNextPage])

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
            const restoredScrollTop = scrollBox.scrollTop
            pendingRestoreRef.current = null
            isRestoringScrollRef.current = true
            // 清理上一个 restoration timer，防止 stale timeout
            if (scrollRestoreTimerRef.current) {
                clearTimeout(scrollRestoreTimerRef.current)
            }
            scrollRestoreTimerRef.current = setTimeout(() => {
                scrollRestoreTimerRef.current = null
                isRestoringScrollRef.current = false
                // scroll restoration 完成后仍在顶部附近 → 自动加载下一页
                // 解决：手动滚到顶部加载一页后，scroll restoration 结束不再有 scroll 事件，
                // 用户必须手动再滚一下才能触发下一页的问题
                if (restoredScrollTop < HISTORY_PREFETCH_DISTANCE
                    && hasNextPageRef.current && !isFetchingNextPageRef.current) {
                    isFillingRef.current = false
                    triggerFetchRef.current(scrollBox.scrollTop, scrollBox.scrollHeight)
                }
            }, RESTORE_SCROLL_GUARD_MS)
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
            // fill 级联模式下不显示 skeleton，避免高度来回跳动导致抖动
            ...(isFetchingNextPage && !isFillingRef.current
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
                content: <CommandProgressBubble icon={<CompressOutlined />} titleKey="chat.compacting" />,
                variant: 'borderless',
            })
        }

        if (isClearing) {
            items.push({
                key: '__clearing__',
                role: 'assistant',
                content: <CommandProgressBubble icon={<ClearOutlined />} titleKey="chat.clearing" />,
                variant: 'borderless',
            })
        }

        return items
    }, [decoratedItems, isFetchingNextPage, isCompressing, isClearing])

    const handleSend = (text: string) => {
        if (import.meta.env.DEV) console.log('[Send] handleSend', { textLen: text.length, hasTrim: !!text.trim() })
        if (!text.trim()) return
        sendMutation.mutate(text)
        if (import.meta.env.DEV) console.log('[Send] sendMutation.mutate 已调用')
    }

    const handleAbort = async () => {
        await sessionActions.abortSession()
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
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', maxWidth: CHAT_MAX_WIDTH, width: '100%', margin: '0 auto' }}>
            {contextHolder}
            <Global styles={bubbleCopyStyles} />
            <Global styles={collapsibleUserMessageStyles} />
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
                        // running 时换用 loading 图标：用户滚离底部时仍能感知「正在生成」，点击回到底部查看
                        icon={session?.running ? <LoadingOutlined /> : <DownOutlined />}
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

            <QueuedMessagesBar
                sessionId={sessionId}
                messages={messages}
                onEdit={(text) => composerRef.current?.setDraft(text)}
            />

            <ChatComposer
                ref={composerRef}
                sessionId={sessionId}
                disabled={sendMutation.isPending || isCompressing || (isClearing && !clearStuck)}
                sending={sendMutation.isPending}
                compressing={isCompressing}
                permissionMode={session?.permissionMode}
                model={session?.runtimeState?.model}
                active={session?.active ?? false}
                allowSendWhenInactive={false}
                running={session?.running ?? false}
                agentState={session?.agentState}
                metadata={metadata}
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
