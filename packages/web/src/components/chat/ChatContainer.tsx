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
import { motion, AnimatePresence } from 'motion/react'
import { Button, theme as antTheme, message } from 'antd'
import { DownOutlined, LoadingOutlined, StopOutlined } from '@ant-design/icons'

import { Global, css } from '@emotion/react'
import { useTranslation } from 'react-i18next'
import type { StopKind } from '@mobi/shared'
import { useMessages } from '@/core/data/hooks/queries/useMessages'
import { useSession } from '@/core/data/hooks/queries/useSession'
import { useSendMessage } from '@/core/data/hooks/mutations/useSendMessage'
import { useSessionActions } from '@/core/data/hooks/mutations/useSessionActions'
import { isQueuedInMobi, isUserMessage } from '@/core/lib/messages'
import { isSegmentEmpty, type ComposerSegments } from '@/domain/chat/composerSegments'
import { reduceChatBlocks, normalizeDecryptedMessage, extractRunningAgents, reconcileChatBlocks, type ChatBlocksById } from '@/domain/chat'
import { buildChatBubbleItems } from './buildBubbleItems'
import { BubbleListChat, type BubbleListChatHandle, type ChatBubbleItem } from './BubbleListChat'
import { reconcileBubbleItems, type BubbleItemsCache } from './reconcileBubbleItems'
import { filterBlocksForPagination } from './filterBlocksForPagination'
import { ChatComposer } from '@/components/composer/ChatComposer'
import { CommandProgressBubble } from './CommandProgressBubble'
import { isCommandInProgress, isClearInProgress, isCompactCompletion, COMPACT_COMMAND, REWIND_COMMAND, isRewindInProgress, getCrossSessionFrom } from '@/domain/chat/presentation'
import { collectUserText } from '@/domain/chat/userContent'
import { canRewindMessage, collectChainHeadUserRowIds, collectRewindBatchText, extractRewindRejectReason, mergeSegmentRows, rewindFilesFailedKey, rewindRejectReasonKey, type NativeMessageMetadata } from '@/domain/chat/rewind'
import { ChatWelcome } from './ChatWelcome'
import { UserMessageFooter } from './UserMessageFooter'
import { CrossSessionTag } from './blocks/CrossSessionTag'
import { type RewindDryRunResult } from './RewindConfirmView'
import { MessageActionsDrawer, type MessageActionTarget } from './MessageActionsDrawer'
import { useMobiApi } from '@/core/data/api/client'
import type { ActionItem } from '@/components/composer/ResponsiveActionBar'
import type { DecryptedMessage, SessionMetadataSummary } from '@/core/data/api/types'
import { useRunningAgentsStore } from '@/core/data/stores/runningAgentsStore'
import { useBackgroundTasksStore, useBackgroundTasks } from '@/core/data/stores/backgroundTasksStore'
import { useRewindStore, useRewindProgress, useRewindCompletion } from '@/core/data/stores/rewindStore'
import { reconcileLatestMessages } from '@/core/data/stores/messageWindowStore'
import { useLongPress } from '@/core/data/hooks/useLongPress'
import { useIsMobile } from '@/core/data/hooks/useMediaQuery'
import { useChatBlocksByIdStore } from '@/core/data/stores/chatBlocksByIdStore'
import { useTeamAgentsStore } from '@/core/data/stores/teamAgentsStore'
import { collapsibleUserMessageStyles } from './CollapsibleUserMessage'
import { spring } from '@/components/motion/presets'

import { MobiLogo } from '@/components/ui/MobiLogo'
// BUBBLE_ROLES 由 BubbleListChat 内部使用（from './bubbleRoles'），此处仅保留 re-export
// 供历史 import './ChatContainer' 的调用方兼容
export { BUBBLE_ROLES } from './bubbleRoles'

const { useToken } = antTheme

/**
 * 取最后一条消息的活动时间戳（供 StatusBar 静默告警，见 AgentLoadingBubble / docs/pending.md #34）：
 * 优先 positionAt（落库排序锚点）；快照消息（未落库）没有 positionAt 但有 createdAt——
 * 快照/token 到达即活动，须一并计入，否则单条消息流式超阈值会被误报「长时间无响应」。
 * 排队消息 positionAt = 提交时刻，同样计入——用户刚发消息也是活动，不应误报等待。
 * 注：单个长工具执行期间无任何新消息到达时仍是盲区（客户端无从感知工具在跑）。
 */
export function lastMessageActivityAt(messages: Array<{ positionAt?: number; createdAt: number }>): number | undefined {
    const last = messages[messages.length - 1]
    return last?.positionAt ?? last?.createdAt
}

/**
 * 取本轮运行的起点时间戳（最后一条有效 user 消息，供 StatusBar 计时）：
 * 刷新页面后从消息列表重算而非组件 mount 时间，计时不会归零；
 * 用户新发一条消息即开启新一轮计时。取值与 lastMessageActivityAt 同源
 * （positionAt 优先，快照/排队消息退 createdAt——排队消息提交时刻即本轮起点，须计入）。
 *
 * - role 读 `content.role`（与 isUserMessage 同口径）——DecryptedMessage **没有**
 *   顶层 role 字段，旧实现读 `m.role` 恒 undefined，计时从未生效（测试用顶层
 *   role 造数据掩盖了错位）
 * - 排除 status='failed' / 'sending' 的乐观消息（与 isQueuedInMobi 的排除口径
 *   一致）：发送失败的消息留在列表但从未开启本轮；在途消息尚未被受理，当前
 *   running 的仍是旧一轮
 */
export function lastUserMessageAt(messages: DecryptedMessage[]): number | undefined {
    for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i]
        if (m.status === 'failed' || m.status === 'sending') continue
        if (isUserMessage(m)) return m.positionAt ?? m.createdAt
    }
    return undefined
}

/**
 * StatusBar 计时起点的合成（docs/pending.md #55 方案 1）：
 * - `fromRuntime`（runtimeState.runStartedAt）：CLI running 翻转 false→true 时上报、hub 落库 +
 *   SSE 推——**权威来源**，长会话消息窗口滑出本轮 user 消息时仍可拿到正确起点
 * - `fromMessages`（lastUserMessageAt）：窗口内消息推导——SSE 事件丢失/尚未到达时比
 *   runtimeState 新（刚出现的 user 消息 vs 上一轮残留值）
 *
 * 取二者最大值：保证单调不回跳——runtimeState 滞后时取窗口内新消息时刻，窗口失守时
 * 取 runtimeState 权威值；两者都缺（首轮刷新 + 窗口为空）返回 undefined（AgentLoadingBubble
 * 回退组件 mount 时间）
 */
export function resolveRunStartedAt(
    fromRuntime: number | undefined,
    fromMessages: number | undefined,
): number | undefined {
    if (fromRuntime == null) return fromMessages
    if (fromMessages == null) return fromRuntime
    return Math.max(fromRuntime, fromMessages)
}

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

/** 移动端长按期间抑制系统选区/长按菜单（AppTooltip 先例：callout + user-select） */
const longPressSuppressStyles = css`
    .chat-longpress-suppress [data-bubble-key] {
        -webkit-touch-callout: none;
        user-select: none;
    }
`

/** 聊天滚动区禁止水平滚动：聊天列表只该垂直滚。
 *  宽内容（代码块等）已在自身 pre 内局部滚动，不该撑出整列表的水平滚动条
 *  （移动端表现为可左右滑到一片空白）。堵住外层容器 + Bubble.List 内部 scrollBox 两层，
 *  并让 scroll-content / 单个 bubble 可收缩，避免正常内容被裁剪 */
const chatScrollStyles = css`
    .chat-scroll-container {
        overflow-x: hidden;
    }
    .chat-scroll-container .ant-bubble-list-scroll-box {
        overflow-x: hidden;
    }
    .chat-scroll-container .ant-bubble-list-scroll-content {
        min-width: 0;
        max-width: 100%;
    }
    .chat-scroll-container .ant-bubble {
        min-width: 0;
        max-width: 100%;
    }
    /* LaTeX 撑宽治本：KaTeX 默认 white-space:nowrap，长公式不可断行，会从 bubble 内部一路撑开
       flex 链 → 整列表水平滚动（移动端窄屏尤甚）。将长公式收进公式块自身横向滚动，不撑破气泡 */
    .chat-scroll-container .katex-display {
        max-width: 100%;
        overflow-x: auto;
        overflow-y: hidden;
    }
`

/** 聊天内容区最大宽度：超宽屏时限宽居中，避免用户/AI 气泡分列两端过于割裂；小屏自动 100% */
const CHAT_MAX_WIDTH = 1200

interface ChatContainerProps {
    sessionId: string
    /** 传递给 ChatComposer 的额外按钮（已废弃，请使用 extraComposerItems） */
    extraComposerButtons?: React.ReactNode
    /** 传递给 ChatComposer 的额外操作项 */
    extraComposerItems?: ActionItem[]
}

/**
 * 聊天容器：消息列表 + composer。
 *
 * 消息列表用 antdx Bubble.List 全量渲染（BubbleListChat），无估高无测量修正、无跳动。
 * 贴底跟随 / 历史加载（prepend 维持 scrollTop / fill 级联 / 顶部 skeleton）均由 BubbleListChat 接管，
 * 复用 useStickToBottom（手势 stop / 几何 re-follow 延时 / smooth 门闩 / pointerDown 守卫）。
 * DOM 随消息量增长，由第二步「数据层窗口化」钳制（见 docs/pending.md #40）。
 *
 * 虚拟化路径（react-virtuoso）已废弃，代码留存于 tag `chat-list-virtualized`，
 * 踩坑记录见 memory（virtuoso-* 系列）。
 */
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
    const chatListRef = useRef<BubbleListChatHandle>(null)
    const [showScrollBottom, setShowScrollBottom] = useState(false)
    // reconcile 结构化共享：维护前一帧 byId，让未变化的 block 保持引用稳定。
    // 无需按 sessionId 重置——本组件由 ChatPane 以 key={sessionId} 挂载，切会话即重建实例。
    const prevByIdRef = useRef<ChatBlocksById>(new Map())
    // bubble item 层的结构化共享缓存（附渲染上下文签名，用于自失效，见 decoratedItems）
    const prevItemsRef = useRef<{ cache: BubbleItemsCache; ctxKey: string }>({ cache: new Map(), ctxKey: '' })
    const { token } = useToken()
    const { t } = useTranslation()
    const api = useMobiApi()

    const metadata = (session?.metadata ?? null) as SessionMetadataSummary | null

    // 最近一次消息活动时间：取最后一条消息（见 lastMessageActivityAt 的取舍说明）
    const lastActivityAt = useMemo(() => lastMessageActivityAt(messages), [messages])
    // 本轮运行起点：runtimeState.runStartedAt（CLI 翻转上报，权威）与窗口内最后一条 user
    // 消息取最大（见 resolveRunStartedAt 的取舍说明）
    const runStartedAt = useMemo(
        () => resolveRunStartedAt(session?.runtimeState?.runStartedAt, lastUserMessageAt(messages)),
        [session?.runtimeState?.runStartedAt, messages],
    )

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

    // 同步 running agents 到 store，供 TasksPanel 订阅
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

    // 同步 backgroundTasks 从 session cache 到 Zustand store，供后台任务面板订阅
    const bgTasks = session?.runtimeState?.backgroundTasks
    useEffect(() => {
        if (bgTasks) {
            // BackgroundTaskItem.toolUseId 为 string|null|undefined，需要映射为 string|null；
            // isBackground 兼容存量 DB 记录（旧数据无此字段，默认按后台处理）
            const mapped = bgTasks.map(t => ({
                ...t,
                toolUseId: t.toolUseId ?? null,
                isBackground: t.isBackground ?? true,
            }))
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

    // 有更多历史页时，过滤掉「孤儿」running tool-call block（结果被分页切走、永久卡 running），
    // 但保留尾部的「活跃」running 工具块（当前正在执行的工具）——否则长任务（如 Write）
    // 会在整个执行窗口被隐藏，直到 tool_result 到达才出现。详见 filterBlocksForPagination。
    // rewind 生命周期 store 订阅（合成块追加/超时兜底/终态收尾共用，须先于 chatBlocks 声明）
    const rewindProgress = useRewindProgress(sessionId)
    const rewindCompletion = useRewindCompletion(sessionId)

    const chatBlocks = useMemo(() => {
        let blocks = filterBlocksForPagination(rawBlocks, hasNextPage)
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
        // 追加 rewind 起点/终点合成块（对齐 bgCompletedTasks 的本地追加模式）：
        // 起点 = 合成 user-text REWIND_COMMAND（不发送不落库，仅驱动 isRewindInProgress，
        //        buildBubbleItems 跳过渲染）；终点 = agent-event rewind-completed
        //        （截断点在列表尾部——锚点之后已被清除，天然落在正确位置；渲染为分隔线）
        if (rewindProgress) {
            blocks = [...blocks, {
                kind: 'user-text' as const,
                id: `rewind-start-${rewindProgress.startedAt}`,
                localId: null,
                createdAt: rewindProgress.startedAt,
                blocks: [{ type: 'text', text: REWIND_COMMAND }],
            }]
        }
        if (rewindCompletion) {
            blocks = [...blocks, {
                kind: 'agent-event' as const,
                id: `rewind-completed-${rewindCompletion.completedAt}`,
                createdAt: rewindCompletion.completedAt,
                event: {
                    type: 'rewind-completed',
                    filesRestored: rewindCompletion.filesRestored,
                    ...(rewindCompletion.error !== undefined ? { error: rewindCompletion.error } : {}),
                } as const,
                meta: undefined,
            }]
        }
        return blocks
    }, [rawBlocks, hasNextPage, bgCompletedTasks, rewindProgress, rewindCompletion])

    // 从 chatBlocks 推导压缩状态：完成标志见 isCompactCompletion（compact-summary 成功路径 + compact-completed 失败兜底）
    const isCompressing = useMemo(
        () => isCommandInProgress(chatBlocks, COMPACT_COMMAND, isCompactCompletion),
        [chatBlocks]
    )

    // /clear 进行中：禁用输入，防止 clear 期间提交新消息（与 isCompressing 共用 isCommandInProgress）
    const isClearing = useMemo(() => isClearInProgress(chatBlocks), [chatBlocks])

    // ──────────────────────────────────────────────────────────────
    // rewind 生命周期（spec §4.1 / §4.5）
    // ──────────────────────────────────────────────────────────────

    // rewind 进行中：禁用输入（完成标志 rewind-completed；rewound-truncated 非终态——文件恢复仍在途）
    const isRewinding = useMemo(() => isRewindInProgress(chatBlocks), [chatBlocks])

    // rewind 弹窗状态：draft 记录目标锚点与入口（PC Popover / 移动 Drawer）；
    // messageId 标识锚定消息（PC Popover 定位到对应 footer）；dryRun null = 预检拉取中；
    // executing = POST 已受理等 SSE 终态
    const [rewindDraft, setRewindDraft] = useState<{ nativeId: string; source: 'modal' | 'drawer'; targetText: string | null; messageId?: string } | null>(null)
    const [rewindDryRun, setRewindDryRun] = useState<RewindDryRunResult | null>(null)
    const [rewindExecuting, setRewindExecuting] = useState(false)
    // 锚点批分段（确认时捕获，rewindFrom 清窗后取不到）+ sender 结构化回填请求（nonce 触发 ChatComposer 应用）
    const pendingBackfillRef = useRef<ComposerSegments | null>(null)
    const [draftRequest, setDraftRequest] = useState<{ segments: ComposerSegments; nonce: number } | undefined>(undefined)
    const draftNonceRef = useRef(0)

    // 会话视图卸载清理（本组件由 ChatPane 以 key={sessionId} 挂载，切会话即重建）
    useEffect(() => {
        return () => useRewindStore.getState().clearSession(sessionId)
    }, [sessionId])

    // rewind 卡死兜底（对齐 clearStuck 模式，spec §4.5）：
    // - truncated 已到、completed 30s 未到（CLI 崩溃于文件恢复阶段，失败模式 #9）→ 超时视为完成（filesRestored 按 false）
    // - 截断前阶段（accepted 后无任何回报）设 90s 硬上限，防 CLI 崩溃于截断前致 sender 永久禁用（spec 外补充兜底）
    // 超时不直接解锁：先对账 refetch 服务端真相（SSE 事件丢失时窗口可能仍显示已删行，M4），
    // 对账期间 progress 保留 → sender 维持禁用（消息不落进未定义时序，#3）；8s 护栏防 refetch 卡死把用户锁死
    const handleRewindTimeout = useCallback(async () => {
        await Promise.race([
            reconcileLatestMessages(api, sessionId),
            new Promise<void>(resolve => { setTimeout(resolve, 8_000) }),
        ])
        // 对账窗口内 SSE 终态可能已先到（completeRewind 守卫吞掉本次）——告警只在
        // 超时兜底真正生效时弹，避免「回退成功却提示超时」的自相矛盾
        const applied = useRewindStore.getState().completeRewind(sessionId, false, 'timeout')
        if (applied) messageApi.warning(t('chat.rewind.timedOut'))
    }, [api, sessionId, messageApi, t])
    useEffect(() => {
        if (!rewindProgress) return
        const timeoutMs = rewindProgress.truncatedAt != null ? 30_000 : 90_000
        const timer = setTimeout(() => { void handleRewindTimeout() }, timeoutMs)
        return () => clearTimeout(timer)
    }, [rewindProgress, handleRewindTimeout])

    // rewind 终态到达：关闭确认 UI、回填 sender、部分失败提示（文件恢复失败=合法降态，spec §5.4）
    useEffect(() => {
        if (!rewindCompletion) return
        setRewindDraft(null)
        setRewindDryRun(null)
        setRewindExecuting(false)
        setActionsTarget(null)
        // 回填在 rewind-completed 之后（失败/超时兜底同样回填——截断已生效，原文已捕获）
        if (pendingBackfillRef.current) {
            setDraftRequest({ segments: pendingBackfillRef.current, nonce: ++draftNonceRef.current })
            pendingBackfillRef.current = null
        }
        if (!rewindCompletion.filesRestored && rewindCompletion.error && rewindCompletion.error !== 'timeout') {
            // 部分降态提示：CLI error 是英文串不直出（对齐 rewindRejectReasonKey 原则），原文留 console 诊断
            console.warn('[rewind] files restore failed:', rewindCompletion.error)
            messageApi.warning(t(rewindFilesFailedKey(rewindCompletion.error)))
        }
    }, [rewindCompletion, messageApi, t])

    // rewind 入口：dry-run 预检 → canRewind 才弹确认（否则 toast，spec §5.3）
    const openRewindDialog = useCallback(async (nativeId: string, source: 'modal' | 'drawer' = 'modal', messageId?: string) => {
        setRewindDraft({ nativeId, source, targetText: collectRewindBatchText(messages, nativeId), messageId })
        setRewindDryRun(null)
        try {
            const res = await api.sessions.rewindDryRun(sessionId, nativeId)
            if (!res.data.canRewind) {
                // 预检拒绝：不弹窗，干净拒绝——链首给 /clear 引导，其余（假锚点/换链旧行）笼统提示
                messageApi.error(t(rewindRejectReasonKey(res.data.reason)))
                setRewindDraft(null)
                return
            }
            setRewindDryRun({ canRewind: true, canRestoreFiles: !!res.data.canRestoreFiles })
        } catch {
            messageApi.error(t('chat.rewind.unavailable'))
            setRewindDraft(null)
        }
    }, [api, sessionId, messageApi, t, messages])

    // rewind 确认执行：受理成功进入生命周期（起点行插入 → sender 禁用），结果等 SSE 两段回报
    const confirmRewind = useCallback(async (restoreFiles: boolean) => {
        if (!rewindDraft) return
        // 回填分段须在截断清窗前捕获（锚点批 N 条原文随后被 rewindFrom 清除，spec §4.4）：
        // 批内多行同 nativeId 时合并还原（正文按 seq join、非 text 结构取首行模板）；
        // 合并结果全空（数据异常）置 null——无从还原时静默放弃回填，不填占位误导用户
        const merged = mergeSegmentRows(messages, rewindDraft.nativeId)
        pendingBackfillRef.current = merged && !isSegmentEmpty(merged) ? merged : null
        setRewindExecuting(true)
        try {
            await api.sessions.rewind(sessionId, rewindDraft.nativeId, restoreFiles)
            useRewindStore.getState().beginRewind(sessionId, rewindDraft.nativeId)
        } catch (err) {
            // 干净失败（闸门拒绝 / 网络错误）：列表与 sender 不动，toast 原因。
            // 与 filesFailed（截断已发生、文件恢复失败的部分降态）区分——本分支 rewind 根本未执行
            setRewindExecuting(false)
            pendingBackfillRef.current = null
            const reason = extractRewindRejectReason(err)
            // busy（多端并发，另一端 rewind 在途）给专用提示；其余保留 reason 细节
            messageApi.error(
                reason.includes('in progress')
                    ? t('chat.rewind.inProgress')
                    : t('chat.rewind.rejected', { reason }),
            )
        }
    }, [rewindDraft, api, sessionId, messages, messageApi, t])

    // PC 入口：messageId 标识锚定消息（footer Popover 定位），nativeId 为 rewind 锚点
    const handleOpenRewind = useCallback((messageId: string, nativeId: string) => {
        void openRewindDialog(nativeId, 'modal', messageId)
    }, [openRewindDialog])

    // 取消 rewind（Popover 取消按钮 / 点击外部 / 再次点击 ⏪）：清 draft + 预检结果
    const cancelRewind = useCallback(() => {
        setRewindDraft(null)
        setRewindDryRun(null)
    }, [])

    // ──────────────────────────────────────────────────────────────
    // 移动端长按操作菜单（spec §5.2）：事件委托到滚动容器
    //（antdx Bubble item 不透传 touch handlers，靠 data-bubble-key 定位目标行）
    // ──────────────────────────────────────────────────────────────
    const isMobile = useIsMobile()
    const [actionsTarget, setActionsTarget] = useState<MessageActionTarget | null>(null)
    // 长按期间抑制系统选区（touchstart 置位、touchend/move 复位）
    const [longPressActive, setLongPressActive] = useState(false)
    // key → 消息操作信息索引（decoratedItems 内重建，判据与 footer 同源）
    const actionsInfoByRef = useRef<Map<string, MessageActionTarget>>(new Map())
    const longPressKeyRef = useRef<string | null>(null)
    // 长按手势起始气泡 DOM（touchstart 记录，openActionsMenu 消费做缩放反馈）
    const pressTargetRef = useRef<HTMLElement | null>(null)

    const openActionsMenu = useCallback(() => {
        const key = longPressKeyRef.current
        longPressKeyRef.current = null
        if (!key) return
        const info = actionsInfoByRef.current.get(key)
        if (!info) return
        setActionsTarget(info)
        // 多模态反馈：视觉（缩放过冲）+ 触觉（Android PWA）同帧触发，因果明确
        const el = pressTargetRef.current
        if (el) {
            el.classList.remove('bubble-press-pop') // 连续长按同一气泡可重放
            void el.offsetWidth // 强制 reflow 重启动画
            el.classList.add('bubble-press-pop')
            el.addEventListener('animationend', () => el.classList.remove('bubble-press-pop'), { once: true })
        }
        // iOS Safari 不支持 vibrate 则静默跳过
        if ('vibrate' in navigator) navigator.vibrate(10)
    }, [])
    const longPress = useLongPress(openActionsMenu)

    const handleBubbleTouchStart = useCallback((e: React.TouchEvent) => {
        const el = (e.target as HTMLElement).closest?.('[data-bubble-key]')
        const key = el?.getAttribute('data-bubble-key') ?? null
        longPressKeyRef.current = key
        // 记录手势起始气泡 DOM，供 openActionsMenu 做长按确认的缩放反馈
        pressTargetRef.current = (e.target as HTMLElement).closest?.('.ant-bubble') as HTMLElement | null
        if (key) {
            setLongPressActive(true)
            longPress.onTouchStart()
        }
    }, [longPress])
    const handleBubbleTouchEnd = useCallback(() => {
        setLongPressActive(false)
        longPressKeyRef.current = null
        longPress.onTouchEnd()
    }, [longPress])
    const handleBubbleTouchMove = useCallback(() => {
        setLongPressActive(false)
        longPress.onTouchMove()
    }, [longPress])
    // 气泡上长按会触发系统 contextmenu（选区/呼出菜单），长按手势期间拦截
    const handleContextMenu = useCallback((e: React.MouseEvent) => {
        if ((e.target as HTMLElement).closest?.('[data-bubble-key]')) e.preventDefault()
    }, [])

    // clear 完成事件（context-cleared）丢失兜底：发送完成 10s 后若仍卡在 clear，强制解禁，
    // 避免输入永久禁用。compact 不加此兜底——其可合法耗时数十秒，超时会误判进行中为卡死。
    const [clearStuck, setClearStuck] = useState(false)
    useEffect(() => {
        setClearStuck(false)
        if (!isClearing || sendMutation.isPending) return
        const timer = setTimeout(() => setClearStuck(true), 10_000)
        return () => clearTimeout(timer)
    }, [isClearing, sendMutation.isPending])

    const handleScrollToBottom = useCallback(() => {
        chatListRef.current?.scrollToBottom('smooth')
    }, [])

    // 传给 BubbleListChat 的稳定回调：内联箭头每次渲染换引用，会让其内部
    // 上抛 following 的 effect 每帧重跑
    const handleFollowingChange = useCallback((following: boolean) => {
        setShowScrollBottom(!following)
    }, [])

    // rewind 判据数据源：会话当前 native session id + 后台任务在途数（store 订阅，spec §3.4）
    const sessionNativeSessionId = metadata?.nativeSessionId
    const backgroundTasksCount = useBackgroundTasks(sessionId).length
    // rewind 互斥（体验层）：POST 在途或截断等待窗口内，其余消息的 rewind 入口一并隐藏——
    // 截断轮等待用户输入时 session.running=false、后台任务为 0，若无此判据可并发触发第二次 rewind
    const rewindBusy = rewindExecuting || rewindProgress != null
    // 链首隐藏（保守判据）：仅当窗口含全部历史时才可判定「其前无同链 assistant 行」的链首用户行
    //（CLI 预检必拒，隐藏免掉「点了必失败」）；窗口未到头（hasNextPage）不可判定 → null = 保守不隐藏。
    // 结构签名缓存（#7）：骨架只取决于行序列的 (id, role, nativeSessionId) 有序序列——流式 chunk
    // 只更新行内容不动结构，签名不变则复用上一帧 Set，跳过 Set 重建；结构真变（追加 / attach 补写 /
    // 消费重排）签名即变自然重建。hasNextPage 未到头时骨架恒 null，签名计算短路
    const chainHeadsCacheRef = useRef<{ key: string; set: Set<string> } | null>(null)
    const chainHeadIds = useMemo(() => {
        if (hasNextPage) return null
        const structureKey = messages
            .map(m => `${m.id}|${(m.content as { role?: string } | null)?.role ?? ''}|${m.metadata?.nativeSessionId ?? ''}`)
            .join(';')
        const cached = chainHeadsCacheRef.current
        if (cached?.key === structureKey) return cached.set
        const set = collectChainHeadUserRowIds(messages)
        chainHeadsCacheRef.current = { key: structureKey, set }
        return set
    }, [messages, hasNextPage])

    const decoratedItems = useMemo(() => {
        const baseItems = buildChatBubbleItems(
            chatBlocks,
            { metadata, isThinking: false, api, sessionId, disabled: sendMutation.isPending },
            !!session?.running,
            { contextResetLabel: t('chat.contextReset'), rewoundToHereLabel: t('chat.rewind.rewoundToHere') },
        )

        // block.id === 消息 id（normalize 以消息 id 作 block id），按 id 建消息 metadata 索引，
        // 供 footer rewind 判据取该行的 native 锚点
        const metaById = new Map<string, NativeMessageMetadata | null>(
            messages.map(m => [m.id, m.metadata ?? null]),
        )
        // 与 metaById 同源同式：message.id → lifecycle（终态标注判据，P3 粗粒度可见）
        const lifecycleById = new Map<string, DecryptedMessage['lifecycle']>(
            messages.map(m => [m.id, m.lifecycle ?? null]),
        )

        const decorated: ChatBubbleItem[] = baseItems.map(item => {
            const block = item.block
            const isUserText = block?.kind === 'user-text'

            // 终态标注判据：cancelled/discarded 的用户消息「这条没被处理」一眼可见；
            // 其余 lifecycle（含 done）与非排队消息不标注（用户不关心传输细节）
            const terminalLifecycle = isUserText && block ? lifecycleById.get(block.id) : null
            const isTerminalLifecycle = terminalLifecycle === 'cancelled' || terminalLifecycle === 'discarded'

            // rewind 判据（footer 操作组与移动长按菜单同源，spec §5.5）
            const rewindable = isUserText && block
                ? canRewindMessage(
                    { metadata: metaById.get(block.id) },
                    sessionNativeSessionId,
                    { running: !!session?.running, backgroundTasks: backgroundTasksCount, rewinding: rewindBusy, active: session?.active },
                    chainHeadIds?.has(block.id),
                )
                : false

            // 跨会话入站来源标签挂气泡 header（填充背景之外、气泡体上方，随 placement: end 右对齐）
            const crossSessionFrom = isUserText && block ? getCrossSessionFrom(block.meta) : null

            // footer：非终态时结构零改动（只增不改）；终态时在 footer 同排左侧加灰色小标注，
            // UserMessageFooter 包 flex:1 容器——时间戳（marginLeft:auto）仍贴最右，标注占左侧
            const baseFooter = isUserText && block ? (
                <UserMessageFooter
                    text={collectUserText(block.blocks)}
                    createdAt={block.createdAt}
                    canRewind={rewindable}
                    onRewind={() => {
                        const nativeId = metaById.get(block.id)?.nativeId
                        if (nativeId) handleOpenRewind(block.id, nativeId)
                    }}
                    rewindOpen={rewindDraft?.source === 'modal' && rewindDraft?.messageId === block.id}
                    rewindTargetText={rewindDraft?.targetText ?? null}
                    rewindDryRun={rewindDryRun}
                    rewindLoading={rewindExecuting}
                    onRewindConfirm={(restoreFiles) => { void confirmRewind(restoreFiles) }}
                    onRewindCancel={cancelRewind}
                />
            ) : undefined

            return {
                ...item,
                header: crossSessionFrom !== null ? <CrossSessionTag from={crossSessionFrom} /> : undefined,
                classNames: isUserText ? { root: 'user-msg-bubble' } : undefined,
                footer: isTerminalLifecycle ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span
                            data-testid="user-msg-terminal"
                            // 弱化呈现：token.colorTextTertiary + 小号字（一眼可见但不抢焦）
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: token.colorTextTertiary, fontSize: 11, flexShrink: 0 }}
                        >
                            <StopOutlined style={{ fontSize: 11 }} />
                            {t(terminalLifecycle === 'cancelled' ? 'chat.message.terminalCancelled' : 'chat.message.terminalDiscarded')}
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>{baseFooter}</div>
                    </div>
                ) : baseFooter,
                footerPlacement: 'outer-end' as const,
            }
        })

        // 移动端长按菜单目标索引（key → 操作信息；判据与 footer 同源同帧计算）
        const actionsInfo = new Map<string, MessageActionTarget>()
        for (const item of decorated) {
            const block = item.block
            if (block?.kind !== 'user-text') continue
            const meta = metaById.get(block.id)
            actionsInfo.set(item.key, {
                key: item.key,
                text: collectUserText(block.blocks),
                nativeId: meta?.nativeId ?? null,
                canRewind: canRewindMessage(
                    { metadata: meta },
                    sessionNativeSessionId,
                    { running: !!session?.running, backgroundTasks: backgroundTasksCount, rewinding: rewindBusy, active: session?.active },
                    chainHeadIds?.has(block.id),
                ),
            })
        }
        actionsInfoByRef.current = actionsInfo

        // 结构化共享：block 未变的 item 复用上一帧对象（连同其 content 元素），
        // 让 BubbleItem 的 memo 真正生效。
        //
        // 缓存自失效：content 由 block + 渲染上下文共同决定，上下文变了必须整体重建，
        // 否则会复用捕获了旧 ctx（旧 disabled / 旧 api / 旧 footer 判据）的 content。这里把上下文签名
        // 与缓存存在一起比对——签名不同则丢弃缓存，从空 Map 重建。
        // 消息 metadata 签名（rewind 判据输入）：nativeId/nativeSessionId/nativeAckAt 的补写
        //（attach/ack）会翻 canRewind，但 block 引用不变 → reconcileBubbleItems 复用旧 footer。
        // 三计数单调增（first-write-wins 只补空缺），任一变化即丢弃 cache 重建 footer
        let nativeIdCount = 0
        let nativeSidCount = 0
        let nativeAckCount = 0
        let terminalLifecycleCount = 0
        for (const m of messages) {
            const md = m.metadata
            if (md?.nativeId) nativeIdCount++
            if (md?.nativeSessionId) nativeSidCount++
            if (md?.nativeAckAt != null) nativeAckCount++
            // lifecycle 终态翻转（queued→cancelled/discarded 广播）不动 block 引用，
            // 但 footer 标注依赖 lifecycleById → 须入签名让缓存失效、footer 随帧重建
            if (m.lifecycle === 'cancelled' || m.lifecycle === 'discarded') terminalLifecycleCount++
        }
        const ctxKey = `${metadata?.path ?? ''}|${sessionId}|${sendMutation.isPending}|${!!session?.running}`
            + `|${sessionNativeSessionId ?? ''}|${backgroundTasksCount}`
            // 会话激活态入签名：CLI 上/下线翻 canRewind（离线时 rewind RPC 无法送达），入口须随帧刷新
            + `|${session?.active ?? ''}`
            // rewind 状态入签名：dry-run 完成 / executing 翻转时 footer 的 Popover 内容须重建；
            // rewindBusy 翻转（受理/终态）翻 canRewind，footer/长按菜单入口须随帧刷新
            + `|${rewindDraft?.messageId ?? ''}|${rewindDraft?.source ?? ''}|${rewindDryRun?.canRewind ?? ''}-${rewindDryRun?.canRestoreFiles ?? ''}|${rewindExecuting}`
            + `|${rewindBusy}`
            // 链首骨架翻转（窗口到头 / 历史补齐）翻 canRewind，入口须随帧刷新；unk = 不可判定
            + `|${chainHeadIds === null ? 'unk' : chainHeadIds.size}`
            // metadata 签名：ack/attach 补写后 rewind 图标即时刷新（而非「刷新才见」）
            + `|${nativeIdCount}-${nativeSidCount}-${nativeAckCount}`
            // lifecycle 终态签名：cancelled/discarded 广播到达后标注即时出现（而非「刷新才见」）
            + `|${terminalLifecycleCount}`
        const reusableCache = prevItemsRef.current.ctxKey === ctxKey
            ? prevItemsRef.current.cache
            : new Map()
        const { items, cache } = reconcileBubbleItems(decorated, reusableCache)
        prevItemsRef.current = { cache, ctxKey }
        return items
    }, [chatBlocks, session?.running, session?.active, metadata, api, sessionId, sendMutation.isPending, t, messages, sessionNativeSessionId, backgroundTasksCount, rewindBusy, chainHeadIds, handleOpenRewind, rewindDraft, rewindDryRun, rewindExecuting, confirmRewind, cancelRewind])

    const bubbleItems = useMemo(() => {
        // 无进行中命令时直接复用 decoratedItems 引用，不做无意义的数组拷贝
        if (!isCompressing && !isClearing && !isRewinding) return decoratedItems

        const items: ChatBubbleItem[] = [...decoratedItems]

        if (isCompressing) {
            items.push({
                key: '__compressing__',
                role: 'assistant',
                content: <CommandProgressBubble titleKey="chat.compacting" />,
                variant: 'borderless',
            })
        }

        if (isClearing) {
            items.push({
                key: '__clearing__',
                role: 'assistant',
                content: <CommandProgressBubble titleKey="chat.clearing" />,
                variant: 'borderless',
            })
        }

        if (isRewinding) {
            items.push({
                key: '__rewinding__',
                role: 'assistant',
                content: <CommandProgressBubble titleKey="chat.rewind.executing" />,
                variant: 'borderless',
            })
        }

        return items
    }, [decoratedItems, isCompressing, isClearing, isRewinding])

    // 入参为 composer 完整分段；wire blocks（serializeSegments）由 useSendMessage 内部统一序列化。
    // 空分段防御性拦截（正常路径由 composer canSend 保证）
    const handleSend = (segments: ComposerSegments) => {
        if (import.meta.env.DEV) console.log('[Send] handleSend', { textLen: segments.text.length })
        if (isSegmentEmpty(segments)) return
        sendMutation.mutate(segments)
        if (import.meta.env.DEV) console.log('[Send] sendMutation.mutate 已调用')
    }

    const handleAbort = async (stopKind: StopKind) => {
        await sessionActions.abortSession(stopKind)
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
            // MobiLogo 小跳 + 文字：svg aria-hidden，语义由文字承载（屏幕阅读器可读）
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, justifyContent: 'center', alignItems: 'center', height: '100%' }}>
                <MobiLogo size={56} />
                <span style={{ fontSize: 13, color: 'var(--ant-color-text-tertiary)' }}>{t('common.loading')}</span>
            </div>
        )
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', maxWidth: CHAT_MAX_WIDTH, width: '100%', margin: '0 auto' }}>
            {contextHolder}
            <Global styles={bubbleCopyStyles} />
            <Global styles={chatScrollStyles} />
            <Global styles={collapsibleUserMessageStyles} />
            <Global styles={longPressSuppressStyles} />
            <div
                className={`chat-scroll-container${longPressActive ? ' chat-longpress-suppress' : ''}`}
                style={{ flex: 1, overflow: 'hidden', padding: '8px 8px', fontFamily: 'var(--font-chat)', position: 'relative' }}
                onTouchStart={isMobile ? handleBubbleTouchStart : undefined}
                onTouchEnd={isMobile ? handleBubbleTouchEnd : undefined}
                onTouchMove={isMobile ? handleBubbleTouchMove : undefined}
                onContextMenu={isMobile ? handleContextMenu : undefined}
            >
                {chatBlocks.length === 0 ? (
                    <ChatWelcome sessionId={sessionId} />
                ) : (
                    <BubbleListChat
                        ref={chatListRef}
                        items={bubbleItems}
                        hasNextPage={hasNextPage}
                        isFetchingNextPage={isFetchingNextPage}
                        onLoadMore={() => {
                            // hasNextPage / isFetchingNextPage 双防御：BubbleListChat 内部已按 ref 检查，
                            // 此处再短路避免无意义的下一页查找 promise + 通知
                            if (hasNextPage && !isFetchingNextPage) void fetchNextPage()
                        }}
                        onFollowingChange={handleFollowingChange}
                    />
                )}
                <AnimatePresence>
                    {showScrollBottom && (
                        <motion.div
                            initial={{ opacity: 0, scale: 0.6 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.6 }}
                            transition={spring.ui}
                            style={{
                                position: 'absolute',
                                left: '50%',
                                x: '-50%',
                                bottom: 32,
                                zIndex: 10,
                                // 容器不挡点击，按钮自身恢复
                                pointerEvents: 'none',
                            }}
                        >
                            <Button
                                type="default"
                                shape="circle"
                                size="middle"
                                // running 时换用 loading 图标：用户滚离底部时仍能感知「正在生成」，点击回到底部查看
                                icon={session?.running ? <LoadingOutlined /> : <DownOutlined />}
                                onClick={handleScrollToBottom}
                                style={{
                                    pointerEvents: 'auto',
                                    boxShadow: token.boxShadowSecondary,
                                    minWidth: 36,
                                    minHeight: 36,
                                }}
                            />
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* 移动端长按操作菜单（仅移动端挂长按，PC 走 footer hover 操作组） */}
            {isMobile && (
                <MessageActionsDrawer
                    open={actionsTarget !== null}
                    target={actionsTarget}
                    rewindActive={rewindDraft?.source === 'drawer' && actionsTarget !== null}
                    dryRun={rewindDryRun}
                    loading={rewindExecuting}
                    onClose={() => {
                        setActionsTarget(null)
                        setRewindDraft(null)
                        setRewindDryRun(null)
                    }}
                    onRewind={(nativeId) => { void openRewindDialog(nativeId, 'drawer') }}
                    onConfirmRewind={(restoreFiles) => { void confirmRewind(restoreFiles) }}
                    onCancelRewind={() => {
                        setRewindDraft(null)
                        setRewindDryRun(null)
                    }}
                />
            )}

            <ChatComposer
                sessionId={sessionId}
                draftRequest={draftRequest}
                disabled={sendMutation.isPending || isCompressing || isRewinding || (isClearing && !clearStuck)}
                sending={sendMutation.isPending}
                compressing={isCompressing}
                permissionMode={session?.permissionMode}
                model={session?.runtimeState?.model}
                active={session?.active ?? false}
                allowSendWhenInactive={false}
                running={session?.running ?? false}
                lastActivityAt={lastActivityAt}
                runStartedAt={runStartedAt}
                agentState={session?.agentState}
                metadata={metadata}
                agentFlavor={agentFlavor}
                mode={session?.mode}
                workingDir={session?.metadata?.path}
                effort={session?.runtimeState?.effort}
                todos={session?.runtimeState?.todos}
                tasks={session?.runtimeState?.tasks}
                contextUsage={session?.runtimeState?.contextUsage ?? null}
                goal={session?.runtimeState?.goalStatus ?? null}
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
