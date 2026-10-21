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
import { theme as antTheme, message } from 'antd'
import { DownOutlined, LoadingOutlined, StopOutlined } from '@ant-design/icons'
import { IconButton } from '@/ui/base/interactive/IconButton'

import { Global, css } from '@emotion/react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from '@tanstack/react-router'
import type { ErrorAction, ErrorContext, NormalizedErrorEvent, StopKind, UiMessageOrigin } from '@mobi/shared'
import { deriveContextFullState, readCrossSessionOrigin, readTurnOrigin, type ContextFullEvent } from '@mobi/shared'
import { useMessages } from '@/core/data/hooks/queries/useMessages'
import { useSession } from '@/core/data/hooks/queries/useSession'
import { useSDKMetadata } from '@/core/data/hooks/queries/useSDKMetadata'
import { useSendMessage } from '@/core/data/hooks/mutations/useSendMessage'
import { useSessionActions } from '@/core/data/hooks/mutations/useSessionActions'
import { useForkSession } from '@/core/data/hooks/mutations/useForkSession'
import { isQueuedInMobi, isUserMessage } from '@/core/lib/messages'
import { isSegmentEmpty, emptySegments, type ComposerSegments, type PendingQuoteRef } from '@/domain/chat/composerSegments'
import { resolveQuoteSelection } from '@/domain/chat/quoteSelection'
import { collectQuoteAnnotationsByAgentId } from '@/domain/chat/quoteDirectives'
import { QUOTE_FLASH_CLASS, QUOTE_FLASH_MS, QUOTE_FRAGMENT_HIGHLIGHT, locateQuotedMessage, type QuoteFragmentOffsets } from '@/core/lib/quoteLocate'
import { copyTextToClipboard } from '@/core/utils/clipboard'
import { reduceChatBlocks, normalizeDecryptedMessage, reconcileChatBlocks, type ChatBlock, type ChatBlocksById } from '@/domain/chat'
import { buildChatBubbleItems } from '@/features/chat/buildBubbleItems'
import { BubbleListChat, type BubbleListChatHandle, type ChatBubbleItem } from '@/features/chat/BubbleListChat'
import { reconcileBubbleItems, type BubbleItemsCache } from '@/features/chat/reconcileBubbleItems'
import { filterBlocksForPagination } from '@/features/chat/filterBlocksForPagination'
import { ChatComposer, type ChatComposerHandle } from '@/pages/session/ChatComposer'
import { UiSendProvider } from '@/ui/openui/actionContext'
import { useOpenUIActionLifecycle } from '@/ui/openui/useOpenUIActionLifecycle'
import { CommandProgressBubble } from '@/features/chat/CommandProgressBubble'
import { CacheExpiredRow } from '@/features/chat/CacheExpiredRow'
import { AgentLoadingBubble } from '@/ui/shared/AgentLoadingBubble'
import { getAgentStatus } from '@/ui/pixel-avatar/types'
import { isCommandInProgress, isClearInProgress, isCompactCompletion, isCompactStart, COMPACT_COMMAND, REWIND_COMMAND, isRewindInProgress, getCrossSessionFrom } from '@/domain/chat/presentation'
import { collectUserText } from '@/domain/chat/userContent'
import { hasActiveTool } from '@/domain/chat/groupToolCalls'
import { isTerminalUserLifecycle, terminalLifecycleLabelKey, terminalReasonLabelKey } from '@/domain/chat/terminalReason'
import { canRewindMessage, collectChainHeadUserRowIds, collectRewindBatchText, extractRewindRejectReason, mergeSegmentRows, rewindFailureKind, rewindFailedReasonKey, rewindFilesFailedKey, rewindRejectReasonKey, type NativeMessageMetadata } from '@/domain/chat/rewind'
import { CLAUDE_MODEL_FALLBACK } from '@/domain/session/types'
import { canForkMessage, collectForkTargetBlockIds, extractForkRejectCode, forkRejectReasonKey } from '@/domain/chat/fork'
import { agentBlockMessageKey, decryptedMessageBlockKeyPrefix } from '@/domain/chat/blockId'
import { ChatWelcome } from '@/features/chat/ChatWelcome'
import { UserMessageFooter } from '@/features/chat/UserMessageFooter'
import { AgentTurnActions } from '@/features/chat/AgentTurnActions'
import { CrossSessionTag } from '@/features/chat/blocks/CrossSessionTag'
import { SentFromTag } from '@/features/chat/blocks/SentFromTag'
import { renderUserBubbleHeader, renderChatBlock, type ChatBlockContext, type ErrorCardContext } from '@/features/chat/blocks'
import { ToolCallGroupRenderer } from '@/features/chat/blocks/toolCallGroupBlock'
import { ToolDetailDrawer } from '@/features/chat/tool-card/ToolDetailDrawer'
import { useToolDetailDrawer } from '@/features/chat/tool-card/useToolDetailDrawer'
import { ComposerStatusPills, useComposerStatusSummary, useComposerStatusPresence, STATUS_PILLS_SPACER_HEIGHT, CHAT_SCROLL_PADDING } from '@/features/composer/ComposerStatusPills'
import type { ClearRuntimeStateField } from '@/ui/base/interactive/ClearStateButton'
import { type RewindDryRunResult } from '@/features/chat/RewindConfirmView'
import { MessageActionsDrawer, MessageActionsTrigger, type MessageActionTarget } from '@/features/chat/MessageActionsDrawer'
import { QuoteSelectionPopover, type QuoteSelectionPopoverState } from '@/features/chat/QuoteSelectionPopover'
import { QuoteCommentInput } from '@/features/chat/QuoteCommentInput'
import { SelectionGhost } from '@/features/chat/SelectionGhost'
import { useMobileQuoteSelection } from '@/features/chat/useMobileQuoteSelection'
import { useKeyboardViewport } from '@/features/chat/useKeyboardViewport'
import { useMobiApi } from '@/core/data/api/client'
import type { ActionItem } from '@/features/composer/ResponsiveActionBar'
import type { DecryptedMessage, SessionMetadataSummary } from '@/core/data/api/types'
import { useForegroundTasksStore } from '@/core/data/stores/foregroundTasksStore'
import { useBackgroundTasksStore, useBackgroundTasks } from '@/core/data/stores/backgroundTasksStore'
import { useRewindStore, useRewindProgress, useRewindCompletion } from '@/core/data/stores/rewindStore'
import { useComposerBackfillStore, useComposerBackfillRequest } from '@/core/data/stores/composerBackfillStore'
import { reconcileLatestMessages } from '@/core/data/stores/messageWindowStore'
import { useIsMobile } from '@/core/data/hooks/useMediaQuery'
import { useChatBlocksByIdStore } from '@/core/data/stores/chatBlocksByIdStore'
import { useTeamAgentsStore } from '@/core/data/stores/teamAgentsStore'
import { collapsibleUserMessageStyles } from '@/features/chat/CollapsibleUserMessage'
import { spring } from '@/ui/base/motion/presets'
import { SKETCH_DOCK_HEIGHT_RATIO, SKETCH_DOCK_GAP, SKETCH_DOCK_SIDE_INSET, SKETCH_Z_COMPOSER } from '@/domain/sketch/sketchLayout'

import { MobiLogo } from '@/ui/base/brand/MobiLogo'
// BUBBLE_ROLES 由 BubbleListChat 内部使用（from '@/ui/base/display/bubbleRoles'），此处仅保留 re-export
// 供历史 import './ChatContainer' 的调用方兼容
export { BUBBLE_ROLES } from '@/ui/base/display/bubbleRoles'

const { useToken } = antTheme

/** 状态气泡让位 spacer：固定高度、无 props，模块级常量避免流式期每个 chunk 重建元素。
 * 布局钩子声明在列表项侧（`bubble-status-spacer`），内部无需再挂类 */
const STATUS_PILLS_SPACER = (
    <div aria-hidden="true" style={{ height: STATUS_PILLS_SPACER_HEIGHT }} />
)

/**
 * 取最后一条消息的锚点时间戳（静默告警活动时间的**兜底来源**；实时路径以
 * messageWindowStore.lastActivityAt 为准，见 ChatContainer 内 lastActivityAt 的合成说明）：
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
 * 取本轮运行的起点时间戳（最后一条有效 user 消息，供聊天区尾部运行指示 AgentLoadingBubble 计时）：
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
 * 运行指示计时起点的合成（docs/pending.md #55 方案 1）：
 * - `fromRuntime`（runtimeState.runStartedAt）：CLI running 翻转 false→true 时上报、daemon 落库 +
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

/** 气泡 hover 时显示 footer 中的操作按钮（用户消息复制/rewind、agent 回复复制/fork、
 * turn-result 概要行操作组同一 hover 显现模式） */
const bubbleCopyStyles = css`
    .user-msg-bubble .msg-copy-btn,
    .agent-msg-bubble .msg-copy-btn,
    .turn-result-bubble .msg-copy-btn {
        opacity: 0;
        transition: opacity 0.15s ease;
    }
    .user-msg-bubble:hover .msg-copy-btn,
    .agent-msg-bubble:hover .msg-copy-btn,
    .turn-result-bubble:hover .msg-copy-btn {
        opacity: 1;
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
    /* 状态气泡让位 spacer 是纯高度占位：抹掉 antd bubble 的上下内衬（气泡 6px +
       内容 12px）与内容最小高度，让预留高度恰为 STATUS_PILLS_SPACER_HEIGHT——
       否则末尾会多出几十像素空白，STATUS_PILLS_SPACER_HEIGHT 也不再是可推导的几何量。
       锚点用列表项显式声明的类，不用 :has()——:has() 会让流式每次插入都重算气泡子树
       （见 buildBubbleItems.bubbleLayoutClass） */
    .chat-scroll-container .ant-bubble.bubble-status-spacer {
        padding-block: 0 !important;
    }
    .chat-scroll-container .ant-bubble.bubble-status-spacer .ant-bubble-content {
        padding-block: 0 !important;
        min-height: 0 !important;
    }
`

/** 聊天内容区最大宽度：超宽屏时限宽居中，避免用户/AI 气泡分列两端过于割裂；小屏自动 100% */
export const CHAT_MAX_WIDTH = 1200

/** 用户滚动手势窗口（ms）：手势后此窗口内的 scroll 才视为用户滚动（关引用浮层）；
 *  流式 stick-to-bottom 的程序滚动无手势先行，不关 */
const USER_SCROLL_GESTURE_WINDOW_MS = 250

/**
 * 鉴权类错误的重新登录指引：错误来自模型供应商，登录态由本机 CLI 掌管，
 * 只能在终端启动 claude 后输入 `/login` 完成——卡片提供可复制的命令，
 * 而不是跳到 web 登录页（web 的 /login 是另一套登录）。
 */
const REAUTH_COMMAND = '/login'

/**
 * 错误卡片的轮次锚点：触发本轮的最后一条用户消息。
 * 错误事件本身不带「属于哪一轮」，按块序向前找最近的 user-text；
 * 卡片上下文（canRewind）与动作派发（重试/回退）经同一入口取锚点，避免两处扫描各写一遍。
 */
function precedingUserTextBlock(blocks: ChatBlock[], blockId: string): Extract<ChatBlock, { kind: 'user-text' }> | undefined {
    const idx = blocks.findIndex((b) => b.id === blockId)
    for (let i = idx - 1; i >= 0; i--) {
        const block = blocks[i]
        if (block?.kind === 'user-text') return block
    }
    return undefined
}

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
        lastActivityAt: streamActivityAt,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
    } = useMessages(sessionId)
    const { data: session } = useSession(sessionId)
    const sendMutation = useSendMessage(sessionId, session?.running ?? false)
    const sessionActions = useSessionActions(sessionId)
    const navigate = useNavigate()
    // 错误卡片的「切换模型」需要备选清单（与 composer 同源：SDK init 上报，缺省用内置回退表）
    const { data: errorSdkMetadata } = useSDKMetadata(sessionId)
    const chatListRef = useRef<BubbleListChatHandle>(null)
    const [showScrollBottom, setShowScrollBottom] = useState(false)
    // ── 画板（气泡 sketch 图重编辑入口，spec D3/D4）──
    // composer 手柄：重编辑完成后产物落回 composer 附件（历史不可变）
    const composerHandleRef = useRef<ChatComposerHandle>(null)
    // PC 停靠容器（消息列表节点）：画板从 composer 上方向上抽出；ref 回调入 state 驱动挂载
    const [chatScrollEl, setChatScrollEl] = useState<HTMLElement | null>(null)
    // PC 全屏容器：聊天列受 CHAT_MAX_WIDTH 限宽居中，全屏浮层要撑满整个内容区，
    // 故挂载层是外层全宽节点（chatFullscreenEl）；聊天列根无独立挂载语义
    const [chatFullscreenEl, setChatFullscreenEl] = useState<HTMLElement | null>(null)
    // 画板停靠几何（px，相对全宽层，浮层定位用）：bottom = composer 区高度
    // （消息列表底边即 composer 顶边），top = 消息列表 70% 高度吊顶位，水平按
    // CHAT_MAX_WIDTH 居中。消息列表/composer 高度随内容与视口变化，RO 测量维护
    const [sketchDockMetrics, setSketchDockMetrics] = useState<{ top: number; bottom: number; left: number; right: number } | null>(null)

    // 画板停靠几何测量（见上）：RO 覆盖消息列表/层自身的尺寸变化（含 composer
    // 增高挤压列表、侧边栏开合改变层宽、窗口 resize 改变两者尺寸）。
    // 同值 bail：高频回调（拖拽输入框、气泡增删）下避免相同几何反复触发
    // ChatContainer 整体重渲染
    useEffect(() => {
        if (!chatFullscreenEl || !chatScrollEl) return
        const measure = () => {
            const layer = chatFullscreenEl.getBoundingClientRect()
            const scroll = chatScrollEl.getBoundingClientRect()
            // 停靠底边 = composer 顶边 + 一缝间距（SKETCH_DOCK_GAP，贴着会粘连成一体）
            const dockBottom = layer.bottom - scroll.bottom + SKETCH_DOCK_GAP
            const dockHeight = scroll.height * SKETCH_DOCK_HEIGHT_RATIO
            // 宽度限宽居中，且两侧保底 SKETCH_DOCK_SIDE_INSET（浮层不贴左右边缘）
            const dockWidth = Math.max(0, Math.min(CHAT_MAX_WIDTH, layer.width - SKETCH_DOCK_SIDE_INSET * 2))
            const dockLeft = (layer.width - dockWidth) / 2
            const next = {
                top: layer.height - dockBottom - dockHeight,
                bottom: dockBottom,
                left: dockLeft,
                right: layer.width - dockLeft - dockWidth,
            }
            setSketchDockMetrics(prev => (prev
                && prev.top === next.top && prev.bottom === next.bottom
                && prev.left === next.left && prev.right === next.right
                ? prev
                : next))
        }
        measure()
        const ro = new ResizeObserver(measure)
        ro.observe(chatScrollEl)
        ro.observe(chatFullscreenEl)
        return () => ro.disconnect()
    }, [chatFullscreenEl, chatScrollEl])
    // reconcile 结构化共享：维护前一帧 byId，让未变化的 block 保持引用稳定。
    // 无需按 sessionId 重置——本组件由 ChatPane 以 key={sessionId} 挂载，切会话即重建实例。
    const prevByIdRef = useRef<ChatBlocksById>(new Map())
    // bubble item 层的结构化共享缓存（附渲染上下文签名，用于自失效，见 decoratedItems）
    const prevItemsRef = useRef<{ cache: BubbleItemsCache; ctxKey: string }>({ cache: new Map(), ctxKey: '' })
    const { token } = useToken()
    const { t } = useTranslation()
    const api = useMobiApi()

    const metadata = (session?.metadata ?? null) as SessionMetadataSummary | null
    /** 待激活分叉会话（forkFrom 在场）：composer 放行 + 发送先触发 resume（spec §4.3） */
    const isPendingFork = !!metadata?.forkFrom

    // 状态气泡浮在聊天区底部（composer 上方）：todo/task 清单与执行中任务摘要。
    // 有内容时列表尾部要追加让位 spacer，最后一条消息才不会被气泡盖住。
    // 气泡摘要只算一次：可见性（spacer）与气泡内容共用同一份合并/统计结果
    const statusTodos = session?.runtimeState?.todos
    const statusTasks = session?.runtimeState?.tasks
    const statusSummary = useComposerStatusSummary(sessionId, statusTodos, statusTasks)
    // spacer / 滚到底按钮偏移跟随气泡的 mounted 窗口（含滑出动画），数据清空时不同步下沉
    const statusPresence = useComposerStatusPresence(statusSummary)
    const showStatusPills = statusPresence.todo.mounted || statusPresence.tasks.mounted
    const taskDrawer = useToolDetailDrawer(sessionId)

    // 最近一次活动时间：实时入库时刻（store，含 snapshot delta 帧）与窗口内最后一条消息
    // 取最大。不能只看消息行：delta 帧只改 content，行的 createdAt 停在流首帧时刻——
    // 模型恢复输出后活跃时间不前进，「still waiting」一旦出现就不会重新计时（2026-10-19 实锤）
    const messagesActivityAt = useMemo(() => lastMessageActivityAt(messages), [messages])
    const lastActivityAt = useMemo(
        () => (streamActivityAt == null ? messagesActivityAt : Math.max(streamActivityAt, messagesActivityAt ?? 0)),
        [streamActivityAt, messagesActivityAt],
    )
    // 传给运行指示时按秒取桶：静默阈值为 120s，秒级精度足够；未取桶时 delta 帧
    // （token 级频率）每次都让 useElapsedSeconds 重建 1s 定时器
    const activityAtSecond = useMemo(
        () => (lastActivityAt == null ? undefined : Math.floor(lastActivityAt / 1000) * 1000),
        [lastActivityAt],
    )
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

    // 同步 chatBlocks byId 到 store，供 ComposerInfoPanel 查找 block
    useEffect(() => {
        useChatBlocksByIdStore.getState().set(sessionId, byId)
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

    // 前台任务清单（foreground-tasks spec）：纯 DB 单源——从 session.runtimeState 装配到
    // store 供「运行中任务」面板订阅，不再从消息 blocks 现算（展示与消息到达性解耦）
    const fgTasks = session?.runtimeState?.foregroundTasks
    useEffect(() => {
        useForegroundTasksStore.getState().set(sessionId, fgTasks ?? [])
        return () => {
            useForegroundTasksStore.getState().clearSession(sessionId)
        }
    }, [fgTasks, sessionId])

    // 同步 teamState 从 session cache 到 Zustand store，供 TasksPanel 团队卡片订阅
    const teamState = session?.runtimeState?.teamState
    useEffect(() => {
        if (teamState) {
            useTeamAgentsStore.getState().setTeamState(
                sessionId,
                teamState.members ?? [],
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
                    ...(rewindCompletion.skippedLinks !== undefined ? { skippedLinks: rewindCompletion.skippedLinks } : {}),
                } as const,
                meta: undefined,
            }]
        }
        return blocks
    }, [rawBlocks, hasNextPage, bgCompletedTasks, rewindProgress, rewindCompletion])

    // 有工具正在执行（与渲染同一份投影）：运行指示静默超阈值时不切「等待响应」——
    // 工具卡自身已表达执行中，长工具（Bash/Agent 等）无新消息属正常，不等于上游挂死
    //（工具卡死另属一维度）。口径见 domain/chat 的 isActiveTool。
    const hasRunningTool = useMemo(() => hasActiveTool(chatBlocks), [chatBlocks])

    // 从 chatBlocks 推导压缩状态：started 见 isCompactStart（手动/自动统一信号）；
    // 完成标志见 isCompactCompletion（compact-summary 成功 + compact-completed 失败兜底
    // + compact_boundary 自动压缩唯一终态）；user-text '/compact' sentinel 兼容旧历史
    const isCompressing = useMemo(
        () => isCommandInProgress(chatBlocks, COMPACT_COMMAND, isCompactCompletion, isCompactStart),
        [chatBlocks]
    )

    // /clear 进行中：禁用输入，防止 clear 期间提交新消息（与 isCompressing 共用 isCommandInProgress）
    const isClearing = useMemo(() => isClearInProgress(chatBlocks), [chatBlocks])

    /** 气泡 sketch 图编辑：取数/回填/失败语义都在 useSketchSession，这里只转发 path */
    const handleEditSketchFromBubble = useCallback((block: { source: { type: string; value: string } }) => {
        composerHandleRef.current?.openBubbleSketch(block.source.value)
    }, [])

    // ──────────────────────────────────────────────────────────────
    // rewind 生命周期（spec §4.1 / §4.5）
    // ──────────────────────────────────────────────────────────────

    // rewind 进行中：禁用输入（完成标志 rewind-completed；rewind-truncated 非终态——文件恢复仍在途）
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
        return () => {
            useRewindStore.getState().clearSession(sessionId)
            // 滞留的回填请求随会话视图离场丢弃（spec §7.5：composer 不在场不回填）
            useComposerBackfillStore.getState().clearSession(sessionId)
        }
    }, [sessionId])

    // ──────────────────────────────────────────────────────────────
    // composer 回填请求消费（撤回 #53 / spec §7.5 / D6；排队消息编辑共用此信箱）
    // ──────────────────────────────────────────────────────────────

    // 请求方（SSE 层 / mutation hook）已落 store 的回填请求（reactive 订阅：请求到达即触发下方 effect）
    const backfillRequest = useComposerBackfillRequest(sessionId)
    // 本次会话视图创建时刻（首帧 render 判定陈旧基线）：早于它的请求属于
    // 「会话未在场」时期，丢弃不回填——隔了会话切换的陈旧回填会覆盖用户当前输入
    const backfillMountedAtRef = useRef(Date.now())
    useEffect(() => {
        // 陈旧甄别只看 createdAt < 视图创建时刻——时间锚定判据天然幂等，effect 每次重跑直接判定即可；
        // render→effect 窗口新到的请求（createdAt >= 基线）照常落到消费回填——
        // 该窗口若被当陈旧清掉，行已被乐观移除且服务端软删，composer 回填是
        // 该文本在 UI 的唯一归宿，丢了即静默丢内容（review Important 修复）
        if (!backfillRequest) return
        if (backfillRequest.createdAt < backfillMountedAtRef.current) {
            useComposerBackfillStore.getState().clearSession(sessionId)
            return
        }
        const req = useComposerBackfillStore.getState().consumeComposerBackfill(sessionId)
        if (!req) return
        // 排队消息编辑但消息已被 agent 处理：不回填，仅提示（本组件长命，toast 在此渲染）
        if (req.notice === 'alreadySubmitted') {
            messageApi.info(t('chat.queued.alreadySubmitted'))
            return
        }
        // 结构化还原成功按分段回填（附件双桶 + 引用一并恢复）；失败兜底 originalText 纯文本
        if (req.segments) {
            setDraftRequest({ segments: req.segments, nonce: ++draftNonceRef.current })
        } else if (req.originalText) {
            setDraftRequest({ segments: { ...emptySegments(), text: req.originalText }, nonce: ++draftNonceRef.current })
        }
    }, [backfillRequest, sessionId, messageApi, t])

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
            // CLI error 是英文串不直出（对齐 rewindRejectReasonKey 原则），原文留 console 诊断：
            // rejected（SDK 拒绝截断）时回退根本未执行，历史未变——绝不能落「对话已回退」的
            // filesFailed 文案（2026-09-29 实踩：拒绝 toast 与失败分隔线矛盾并存）；files 类
            // （截断已生效、仅文件恢复失败）才是合法降态提示
            console.warn('[rewind] completed with error:', rewindCompletion.error)
            if (rewindFailureKind(rewindCompletion.error) === 'rejected') {
                messageApi.error(t('chat.rewind.rejectedByCC'))
            } else {
                messageApi.warning(t(rewindFilesFailedKey(rewindCompletion.error)))
            }
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
    // fork 生命周期（fork-session spec §4.2/§4.3）：入口 → 确认 → 创建 → 跳转
    // fork 无 dry-run 预检（daemon 侧纯动作，失败确认后 toast 归因）；
    // draft 记录锚点与入口（PC Popover / 移动 Drawer），messageId 定位 PC Popover
    // ──────────────────────────────────────────────────────────────
    const [forkDraft, setForkDraft] = useState<{ anchorNativeId: string; source: 'popover' | 'drawer'; targetText: string | null; messageId?: string } | null>(null)
    // fork 会话创建 mutation（POST + 工作区维度视图失效 + 跳转新会话，导航收口在 hook 内）
    const { forkSession, isPending: forkPending } = useForkSession(sessionId)

    // PC 入口：messageId 标识锚定消息（footer Popover 定位），锚点 = agent 回复 nativeId
    const openForkPopover = useCallback((messageId: string, anchorNativeId: string, targetText: string) => {
        setForkDraft({ anchorNativeId, source: 'popover', targetText, messageId })
    }, [])

    // 取消 fork（Popover/Drawer 取消按钮 / 点击外部）
    const cancelFork = useCallback(() => {
        setForkDraft(null)
    }, [])

    // fork 确认执行：成功即跳转（本组件随 ChatPane key 切换卸载）；失败 toast 归因，收起确认 UI
    const confirmFork = useCallback(async () => {
        if (!forkDraft) return
        try {
            await forkSession(forkDraft.anchorNativeId)
            setForkDraft(null)
        } catch (err) {
            setForkDraft(null)
            const code = extractForkRejectCode(err)
            console.warn('[fork] forkSession rejected:', code)
            messageApi.error(t(forkRejectReasonKey(code)))
        }
    }, [forkDraft, forkSession, messageApi, t])

    // ──────────────────────────────────────────────────────────────
    // 移动端消息操作菜单（原长按入口，spec 移动端手势仲裁后迁到气泡 footer「⋯」）：
    // actionsTarget 只由 MessageActionsTrigger 点击置位（见 decoratedItems footer）
    // ──────────────────────────────────────────────────────────────
    const isMobile = useIsMobile()
    // 虚拟键盘是否弹出（keyboardInset>0）：ghost 隐藏判据（QuoteCommentInput 同源做键盘跟随）
    const { keyboardInset: kbInset } = useKeyboardViewport()
    const [actionsTarget, setActionsTarget] = useState<MessageActionTarget | null>(null)
    // key → 消息操作信息索引（decoratedItems 内重建，判据与 footer 同源）
    const actionsInfoByRef = useRef<Map<string, MessageActionTarget>>(new Map())

    // ──────────────────────────────────────────────────────────────
    // 选区引用入口（spec「入口」）：PC mouseup / 移动端 selectionchange 两条薄壳
    // 拿选区交给选区判定器（唯一裁决点），本层只管浮层开合与手柄灌入
    // ──────────────────────────────────────────────────────────────
    const [quotePopover, setQuotePopover] = useState<QuoteSelectionPopoverState | null>(null)
    // 评论输入浮层：「添加到对话」**即落引用**（composer 已有条目），此浮层只补充评论——
    // uid 寻址 composer 条目，rects = 捕获时冻结的选区行盒（SelectionGhost 保持选中观感）
    const [quoteCommentDraft, setQuoteCommentDraft] = useState<{
        uid: string
        initialComment?: string
        rect: DOMRect
        rects: DOMRect[]
    } | null>(null)

    // 判定收口：非空选区 → 判定器裁决 → 浮层三态（可添加 / 超长禁用 / 达上限禁用）。
    // 来源/归属类拒绝不弹不打扰（spec：静默失败体验差仅对可解释的原因豁免）
    const openQuotePopoverForRange = useCallback((range: Range) => {
        const count = composerHandleRef.current?.getQuoteCount() ?? 0
        const result = resolveQuoteSelection(range, { currentQuoteCount: count })
        if (result.ok) {
            setQuotePopover({ kind: 'add', quote: result.quote, range, rect: range.getBoundingClientRect() })
        } else if (result.reason === 'tooLong' || result.reason === 'limitReached') {
            // 禁用态也要弹（spec：静默失败体验差）；来源/归属类拒绝不弹不打扰
            setQuotePopover({ kind: result.reason, rect: range.getBoundingClientRect() })
        } else {
            setQuotePopover(null)
        }
    }, [])

    // PC 薄壳：mouseup 即判定（桌面端选区在 mouseup 时已稳定）
    const handleSelectionMouseUp = useCallback(() => {
        const sel = window.getSelection()
        const range = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null
        if (range) {
            openQuotePopoverForRange(range)
        } else {
            setQuotePopover(null)
        }
    }, [openQuotePopoverForRange])

    // 移动端薄壳：selectionchange 防抖落定的非空选区走同一判定收口
    useMobileQuoteSelection({ enabled: isMobile, onSelectionSettled: openQuotePopoverForRange })

    // 「添加到对话」**即落引用**（composer 已有条目，条目级信息带出供续编辑），
    // 评论浮层只补充评论；选区原生高亮随即让位给 SelectionGhost（输入框夺焦必清原生选区）
    const handleQuoteAdd = useCallback((quote: PendingQuoteRef) => {
        const entry = composerHandleRef.current?.addQuote(quote) ?? null
        // onAdd 仅在 add 态触发，range 必在（union 收窄）
        const addState = quotePopover?.kind === 'add' ? quotePopover : null
        if (entry && addState) {
            setQuoteCommentDraft({
                uid: entry.uid,
                initialComment: entry.comment,
                rect: addState.rect,
                rects: Array.from(addState.range.getClientRects()),
            })
        }
        setQuotePopover(null)
    }, [quotePopover])

    // 评论保存 = 补写 composer 条目（trim 空串 = 维持无评论）+ 清选区（引用已确认，使命完成）
    const handleQuoteCommentSave = useCallback((comment: string | undefined) => {
        if (quoteCommentDraft) composerHandleRef.current?.updateQuoteComment(quoteCommentDraft.uid, comment)
        setQuoteCommentDraft(null)
        window.getSelection()?.removeAllRanges()
    }, [quoteCommentDraft])

    // 评论关闭（× / Esc / 点浮层外 / 滚动）= 只关浮层：**引用保留（无评论态）+ 选区保留**
    //（用户可重新划选或再次点开同片段补评论，摘高亮是打断感的主要来源）
    const handleQuoteCommentClose = useCallback(() => {
        setQuoteCommentDraft(null)
    }, [])

    // 引用浮层（add 态）开着时选区被清（点击它处）或用户滚动即关闭（选区几何已失效，浮层不跟随）；
    // Esc 同样收起。scroll 不冒泡，capture 监听才能截获内层滚动容器的滚动。
    // 评论输入浮层**不走** selectionchange 关闭——autoFocus 会把选区收进输入框（collapsed），
    // 依赖它会刚打开即被误关；其取消路径 = mousedown 落在 data-quote-layer 外 / 滚动 / 取消按钮
    //
    // 「滚动」只认**用户滚动手势**（wheel / touchmove）后短窗口内的 scroll：会话 running 时
    // stick-to-bottom 的程序滚动随每个流式 chunk 触发，若照单全收，浮层刚弹开即被关掉
    // （2026-09-23 实测「running 时 popover 闪一下立刻消失」）；几何漂移在流式期间可容忍，
    // 用户真滚动（浮层该关）必有手势先行。
    const lastUserScrollGestureAtRef = useRef(0)
    useEffect(() => {
        const mark = () => { lastUserScrollGestureAtRef.current = performance.now() }
        window.addEventListener('wheel', mark, { passive: true })
        window.addEventListener('touchmove', mark, { passive: true })
        return () => {
            window.removeEventListener('wheel', mark)
            window.removeEventListener('touchmove', mark)
        }
    }, [])
    const wasUserScroll = useCallback(
        () => performance.now() - lastUserScrollGestureAtRef.current < USER_SCROLL_GESTURE_WINDOW_MS,
        [],
    )

    useEffect(() => {
        if (!quotePopover) return
        const close = () => setQuotePopover(null)
        const onSelectionChange = () => {
            const sel = window.getSelection()
            if (!sel || sel.isCollapsed) close()
        }
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') close()
        }
        const onScroll = () => {
            if (wasUserScroll()) close()
        }
        document.addEventListener('selectionchange', onSelectionChange)
        document.addEventListener('keydown', onKeyDown)
        window.addEventListener('scroll', onScroll, true)
        return () => {
            document.removeEventListener('selectionchange', onSelectionChange)
            document.removeEventListener('keydown', onKeyDown)
            window.removeEventListener('scroll', onScroll, true)
        }
    }, [quotePopover, wasUserScroll])

    // 评论输入：点击浮层外按取消处理（只关浮层不清选区，同 handleQuoteCancel 的取舍）；
    // 滚动即取消（几何失效）——但排除浮层**内部**元素的滚动：多行评论插入换行后光标
    // 下移会让 textarea 自身内部滚动（scrollTop 变化），capture 监听会捕到，若不排除
    // 则「按 Enter 换行」被误判为页面滚动直接关浮层（2026-09-22 实测，现象恰似确认）
    useEffect(() => {
        if (!quoteCommentDraft) return
        const close = () => setQuoteCommentDraft(null)
        const onMouseDown = (e: MouseEvent) => {
            const target = e.target as HTMLElement | null
            if (!target?.closest('[data-quote-layer]')) close()
        }
        const onScroll = (e: Event) => {
            const target = e.target as HTMLElement | null
            if (target?.closest?.('[data-quote-layer="comment"]')) return
            if (wasUserScroll()) close()
        }
        document.addEventListener('mousedown', onMouseDown)
        window.addEventListener('scroll', onScroll, true)
        return () => {
            document.removeEventListener('mousedown', onMouseDown)
            window.removeEventListener('scroll', onScroll, true)
        }
    }, [quoteCommentDraft, wasUserScroll])

    // 「⋯」入口：footer 触发按钮按 bubble item key 从索引取目标（点击等价原长按打开 Drawer）
    const openActionsByItemKey = useCallback((key: string) => {
        setActionsTarget(actionsInfoByRef.current.get(key) ?? null)
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

    // 引用定位入口的统一收口：跳转 = 用户intent看历史 → 先停贴底跟随再滚动，
    // 否则流式期间 RO 追赶钉底与 scrollIntoView 争抢 scrollTop（跳过去立刻被拉回底部）
    const handleQuoteLocate = useCallback((messageId: string, offsets?: QuoteFragmentOffsets) => {
        chatListRef.current?.stopFollow()
        locateQuotedMessage(messageId, offsets)
    }, [])

    // 回应批注数据源：agent 消息 id → 触发本轮回复的 user 消息 quote blocks。
    // turn 配对规则收口在 domain（collectQuoteAnnotationsByAgentId，/simplify）；
    // 无批注会话返回共享空 Map，流式每帧调用零分配
    const quoteAnnotationsByAgentId = useMemo(
        () => collectQuoteAnnotationsByAgentId(chatBlocks),
        [chatBlocks],
    )

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

    // 引用定位高亮闪烁样式（quote-locate-flash）：单份注入在聊天列表层（随本组件生灭），
    // 不落 QuoteGroupView——每实例 Global 会在长会话重复挂载同名规则
    const quoteFlashStyles = useMemo(() => css`
        .${QUOTE_FLASH_CLASS} {
            animation: quote-locate-flash-kf ${QUOTE_FLASH_MS}ms ease-out;
            border-radius: ${token.borderRadiusLG}px;
        }
        @keyframes quote-locate-flash-kf {
            /* 高亮外扩不贴内容：第二层 box-shadow 用大 spread 画外圈底色带——
               纯视觉层不占布局（padding 方案会挤占内容宽度引发重排，摘类后排布变化） */
            0% { box-shadow: 0 0 0 3px ${token.colorWarningBorder}, 0 0 0 14px ${token.colorWarningBg}; background: ${token.colorWarningBg}; }
            100% { box-shadow: 0 0 0 3px transparent, 0 0 0 14px transparent; background: transparent; }
        }
        /* 片段级高亮（CSS Custom Highlight API，quoteLocate 注册）：
           ::highlight 的背景动画主流浏览器不可靠，用「常亮 + 定时摘除」形态。
           colorWarningBg 在 dark 档是深棕（黑底上不可辨，E2E 实测），用 colorWarning
           实色低透明——两主题都是明快警示色，高亮可辨；无圆角能力（规范限制） */
        ::highlight(${QUOTE_FRAGMENT_HIGHLIGHT}) {
            background-color: color-mix(in srgb, ${token.colorWarning} 35%, transparent);
        }
    `, [token])

    // ──────────────────────────────────────────────────────────────
    // 错误卡片宿主（error-presentation）：上下文派生 + 动作派发
    // ──────────────────────────────────────────────────────────────
    const errorModelList = errorSdkMetadata?.models?.length ? errorSdkMetadata.models : CLAUDE_MODEL_FALLBACK
    const errorFallbackModel = errorModelList.find((m) => m.value !== (session?.runtimeState?.model ?? null))?.value ?? null
    const errorSessionState: 'active' | 'dormant' | 'ended' = session?.active
        ? 'active'
        : session?.endReason === 'pause' ? 'dormant' : 'ended'

    /**
     * 上下文满状态机的输入序列：只收「上下文满错误 + 压缩生命周期」事件块，
     * 并记下每个错误块在序列里的锚点。错误卡片逐个渲染，序列只随块列表变化重算一次。
     *
     * - result 错误也是上下文满的主路径之一（errorDetail.category），同样登记锚点
     * - 非 /compact 的新用户输入写入 `turn-end`：其后的压缩属于下一轮，不该影响本锚点
     */
    const contextFullEvents = useMemo(() => {
        const events: ContextFullEvent[] = []
        const anchorByBlockId = new Map<string, number>()
        for (const block of chatBlocks) {
            if (block.kind === 'user-text') {
                if (collectUserText(block.blocks).trim() !== COMPACT_COMMAND) events.push({ type: 'turn-end' })
                continue
            }
            if (block.kind !== 'agent-event') continue
            const ev = block.event
            const kind: ContextFullEvent['type'] | null =
                ev.type === 'compact-started' ? 'compact-started'
                    : ev.type === 'compact' || ev.type === 'compact-completed' ? 'compact'
                        : ev.type === 'error' && ev.category === 'context_length' ? 'error'
                            : (ev as { errorDetail?: { category?: string } }).errorDetail?.category === 'context_length' ? 'error'
                                : null
            if (!kind) continue
            anchorByBlockId.set(block.id, events.length)
            events.push({ type: kind })
        }
        return { events, anchorByBlockId }
    }, [chatBlocks])

    /**
     * 每个块所属轮次「有没有助手产出」：重试动作只在本轮无产出时成立（spec 动作表）。
     *
     * 判据覆盖整轮（含错误之后才到达的输出）——自动重试成功后，历史错误卡若还留着
     * 「重试」，点一下就会把旧用户消息当新消息再发一次、重跑整轮工作。
     */
    const turnHasOutputByBlockId = useMemo(() => {
        const turnByBlockId = new Map<string, string>()
        const outputTurns = new Set<string>()
        let currentTurn = ''
        for (const block of chatBlocks) {
            if (block.kind === 'user-text') currentTurn = block.id
            turnByBlockId.set(block.id, currentTurn)
            if (block.kind === 'agent-text' || block.kind === 'agent-reasoning' || block.kind === 'tool-call') {
                outputTurns.add(currentTurn)
            }
        }
        const produced = new Map<string, boolean>()
        for (const [blockId, turn] of turnByBlockId) produced.set(blockId, outputTurns.has(turn))
        return produced
    }, [chatBlocks])

    /** 错误卡片上下文：canRewind 绑定「触发本轮的最后一条用户消息」，压缩状态由块序列现算 */
    const errorContextFor = useCallback((blockId: string): ErrorContext => {
        const target = precedingUserTextBlock(chatBlocks, blockId)
        const targetMessage = target ? messages.find((m) => m.id === target.id) : undefined
        const canRewind = Boolean(target) && canRewindMessage(
            { metadata: targetMessage?.metadata ?? null, seq: targetMessage?.seq ?? null },
            sessionNativeSessionId,
            { running: !!session?.running, backgroundTasks: backgroundTasksCount, rewinding: rewindBusy, active: session?.active, contextBoundarySeq: metadata?.contextBoundarySeq },
            chainHeadIds?.has(target!.id),
        )

        const anchor = contextFullEvents.anchorByBlockId.get(blockId)
        const fullState = anchor !== undefined
            ? deriveContextFullState(contextFullEvents.events, anchor)
            : undefined

        return {
            canRewind,
            // 与 composer 的禁用条件同源：压缩/回退/清空进行中不允许发送，卡片动作也不能绕过
            canSend: errorSessionState === 'active' && !sendMutation.isPending && !isCompressing && !isRewinding && !(isClearing && !clearStuck),
            sessionState: errorSessionState,
            ...(fullState && { compact: { pending: fullState.pending, tried: fullState.tried } }),
            hasFallbackModel: errorFallbackModel !== null,
            hasWorkspace: Boolean(session?.workspaceId),
            turnHasAssistantOutput: turnHasOutputByBlockId.get(blockId) ?? false,
        }
    }, [chatBlocks, contextFullEvents, turnHasOutputByBlockId, messages, session?.running, session?.active, session?.endReason, session?.workspaceId, metadata?.contextBoundarySeq, sessionNativeSessionId, backgroundTasksCount, rewindBusy, chainHeadIds, sendMutation.isPending, isCompressing, isRewinding, isClearing, clearStuck, errorSessionState, errorFallbackModel])

    // 动作派发入口：只在点击时执行，经 ref 取最新闭包（赋值在下方命令式区），不拖累装配链 memo
    const errorActionRef = useRef<(action: ErrorAction, blockId: string, event: NormalizedErrorEvent) => void>(() => {})
    const errorCardContext = useMemo<ErrorCardContext>(() => ({
        contextFor: errorContextFor,
        onAction: (action, blockId, event) => errorActionRef.current(action, blockId, event),
    }), [errorContextFor])

    const decoratedItems = useMemo(() => {
        // ── fork 判据数据（fork-session spec §4.1/§4.2）──
        // 入口仅挂「turn 的 result 落点」：每 turn 最后一条 agent 文本块的 id 集合
        const forkTargetBlockIds = collectForkTargetBlockIds(chatBlocks)
        // agent 文本块 → 消息行查表 key（与 reducerTimeline blockId 前缀同源，
        // 见 domain/chat/blockId.ts；按 key 建行索引供锚点/seq 查询）
        const forkRowByKey = new Map<string, { metadata: NativeMessageMetadata | null; seq: number | null }>(
            messages.map(m => [decryptedMessageBlockKeyPrefix(m), { metadata: m.metadata ?? null, seq: m.seq ?? null }]),
        )
        // canForkMessage 的会话状态入参一次构造（PC 概要行操作组与移动「⋯」菜单共用，
        // 判据字段增删只改这一处）；canForkMessage 调用同样收口为 forkableOfRow
        const forkSessionState = {
            running: !!session?.running,
            backgroundTasks: backgroundTasksCount,
            mode: session?.mode,
            forkedFrom: metadata?.forkedFrom,
            forkFrom: metadata?.forkFrom,
            contextBoundarySeq: metadata?.contextBoundarySeq,
        }
        const forkableOfRow = (row: { metadata: NativeMessageMetadata | null; seq: number | null }) =>
            canForkMessage({ metadata: row.metadata, seq: row.seq }, sessionNativeSessionId, forkSessionState)

        // ── turn-result 概要行操作组（position A）──
        // 落点 agent 文本与其 turn-result 概要事件配对：文本块是 fork 判据载体，操作组展示在
        // 概要行尾。扫描 chatBlocks，「最近一个可 fork 落点文本」配给其后首个 turn-result 事件
        // （配对即清空——无落点文本的 turn 不继承上一轮的操作组）。
        // ⚠️ 必须先于 buildChatBubbleItems：ctx.turnResultActions 工厂闭包引用本 Map
        const turnResultActionsByKey = new Map<string, React.ReactNode>()
        {
            let current: { key: string; text: string; row: { metadata: NativeMessageMetadata | null; seq: number | null }; forkable: boolean } | null = null
            for (const block of chatBlocks) {
                if (block.kind === 'agent-text') {
                    const row = forkTargetBlockIds.has(block.id)
                        ? forkRowByKey.get(agentBlockMessageKey(block))
                        : undefined
                    // 落点文本存在即入配对（复制不受 fork 守卫约束），forkable 仅控制 ⑂ 入口
                    current = row ? { key: block.id, text: block.text, row, forkable: forkableOfRow(row) } : null
                } else if (block.kind === 'agent-event' && block.event.type === 'turn-result' && current) {
                    const matched = current
                    turnResultActionsByKey.set(block.id, isMobile ? (
                        // 移动端「⋯」与 PC 操作组同位（概要行尾，紧贴 usage meta）——
                        // 不再悬在气泡下方 footer。判据与 actionsInfo agent 分支同源（可 fork 才挂）
                        matched.forkable
                            ? <MessageActionsTrigger onClick={() => openActionsByItemKey(matched.key)} />
                            : undefined
                    ) : (
                        <AgentTurnActions
                            text={matched.text}
                            showFork={matched.forkable}
                            onFork={() => {
                                const nativeId = matched.row.metadata?.nativeId
                                if (nativeId) openForkPopover(matched.key, nativeId, matched.text)
                            }}
                            forkOpen={forkDraft?.source === 'popover' && forkDraft?.messageId === matched.key}
                            forkTargetText={forkDraft?.targetText ?? null}
                            forkLoading={forkPending}
                            onForkConfirm={() => { void confirmFork() }}
                            onForkCancel={cancelFork}
                        />
                    ))
                    current = null
                }
            }
        }

        // block.id === 消息 id（normalize 以消息 id 作 block id），按 id 建消息 metadata 索引，
        // 供 footer rewind 判据取该行的 native 锚点
        const metaById = new Map<string, NativeMessageMetadata | null>(
            messages.map(m => [m.id, m.metadata ?? null]),
        )
        // 与 metaById 同源同式：message.id → seq（rewind 边界判据的比较操作数，fork-session spec §2/§6）
        const seqById = new Map<string, number | null>(
            messages.map(m => [m.id, m.seq ?? null]),
        )
        // 与 metaById 同源同式：message.id → lifecycle（终态标注判据，P3 粗粒度可见）
        const lifecycleById = new Map<string, DecryptedMessage['lifecycle']>(
            messages.map(m => [m.id, m.lifecycle ?? null]),
        )

        const renderCtx: ChatBlockContext = {
            metadata, isThinking: false, api, sessionId, disabled: sendMutation.isPending,
            turnResultActions: (block) => turnResultActionsByKey.get(block.id),
            onEditSketchBlock: (block) => { void handleEditSketchFromBubble(block) },
            onQuoteLocate: handleQuoteLocate,
            resolveQuoteAnnotations: (agentMessageId) => quoteAnnotationsByAgentId.get(agentMessageId),
            errorCard: errorCardContext,
        }
        const baseItems = buildChatBubbleItems(
            chatBlocks,
            renderCtx,
            !!session?.running,
            { contextResetLabel: t('chat.contextReset'), rewoundToHereLabel: t('chat.rewind.rewoundToHere'), rewindFailedLabel: t('chat.rewind.rewindFailed'), rewindFailedReasonLabel: t(rewindFailedReasonKey(rewindCompletion?.error)), skippedLinksLabel: t('chat.rewind.skippedLinks'), renderBlock: renderChatBlock, renderToolGroup: (p) => <ToolCallGroupRenderer {...p} /> },
        )

        // 移动端「⋯」菜单目标索引（key → 操作信息；判据与 footer 同源同帧计算）。
        // 迭代 baseItems 即可（decorated 只追加装饰字段，key/block 同源）；先于 decorated
        // 构建，让下方 footer 组装能按 key 判断「⋯」入口是否挂载
        const actionsInfo = new Map<string, MessageActionTarget>()
        for (const item of baseItems) {
            const block = item.block
            if (block?.kind === 'user-text') {
                const meta = metaById.get(block.id)
                actionsInfo.set(item.key, {
                    key: item.key,
                    text: collectUserText(block.blocks),
                    nativeId: meta?.nativeId ?? null,
                    canRewind: canRewindMessage(
                        { metadata: meta, seq: seqById.get(block.id) },
                        sessionNativeSessionId,
                        { running: !!session?.running, backgroundTasks: backgroundTasksCount, rewinding: rewindBusy, active: session?.active, contextBoundarySeq: metadata?.contextBoundarySeq },
                        chainHeadIds?.has(block.id),
                    ),
                    forkAnchorId: null,
                    canFork: false,
                })
                continue
            }
            // agent 回复落点：可 fork 时进菜单（复制 + 从此分叉）；不可 fork 不进（与既有入口范围一致）
            if (block?.kind === 'agent-text' && forkTargetBlockIds.has(block.id)) {
                const row = forkRowByKey.get(agentBlockMessageKey(block))
                if (!row || !forkableOfRow(row)) continue
                actionsInfo.set(item.key, {
                    key: item.key,
                    text: block.text,
                    nativeId: null,
                    canRewind: false,
                    forkAnchorId: row?.metadata?.nativeId ?? null,
                    canFork: true,
                })
            }
        }
        actionsInfoByRef.current = actionsInfo

        const decorated: ChatBubbleItem[] = baseItems.map(item => {
            const block = item.block
            const isUserText = block?.kind === 'user-text'

            // 终态标注判据：cancelled/discarded/refused 的用户消息「这条没被处理/没被接收」一眼可见；
            // 其余 lifecycle（含 done）与非排队消息不标注（用户不关心传输细节）。
            // 终态附带 terminal_reason 原因标注（已知 key 才出，spec §7.6——refused 与 cancelled 同等适用）
            const terminalLifecycle = isUserText && block ? lifecycleById.get(block.id) : null
            const terminalLabelKey = terminalLifecycleLabelKey(terminalLifecycle)
            const terminalReasonKey = terminalLabelKey !== null && block
                ? terminalReasonLabelKey(metaById.get(block.id)?.terminalReason)
                : null

            // rewind 判据（footer 操作组与移动端「⋯」菜单同源，spec §5.5）
            const rewindable = isUserText && block
                ? canRewindMessage(
                    { metadata: metaById.get(block.id), seq: seqById.get(block.id) },
                    sessionNativeSessionId,
                    { running: !!session?.running, backgroundTasks: backgroundTasksCount, rewinding: rewindBusy, active: session?.active, contextBoundarySeq: metadata?.contextBoundarySeq },
                    chainHeadIds?.has(block.id),
                )
                : false

            // fork 判据已移入 turn-result 操作组配对扫描（见 turnResultActionsByKey 构建）；
            // 移动端「⋯」菜单的 fork 判据在 actionsInfo 内独立计算（同源同式）

            // 跨会话入站来源标签挂气泡 header（填充背景之外、气泡体上方，随 placement: end 右对齐）
            // 判据是「来源身份存在」（readCrossSessionOrigin 非 null），不是「from 非空」——
            // 发送方还没名字（change_title 之前的新会话）时 from 是空串，但那依然是跨会话消息，
            // 标签该走 CrossSessionTag 的通用文案分支，否则整条标签会消失、看起来像用户自己发的。
            // scheduled / loop 唤醒不需要单独判：toCrossSessionMeta 对每条入站 turn 都写 crossSession
            // （来源身份即使为空也照写），故来源判据已覆盖它们
            const crossSessionOrigin = isUserText && block ? readCrossSessionOrigin(block.meta) : null
            // 展示名是 web 自己的翻译（空名字降级为 null，落到 CrossSessionTag 的通用文案分支）：
            // 从上面那个 origin 投影出来，不再拿同一条 meta 解析第二遍
            const crossSessionFrom = getCrossSessionFrom(crossSessionOrigin)
            const turnOrigin = isUserText && block ? readTurnOrigin(block.meta) : null
            const showCrossSessionTag = crossSessionOrigin !== null
            // UI 来源标记（票 06 安全缓解）：openui/app 回灌的消息与手打可辨识；
            // 跨会话消息 sentFrom='cli' 不命中（SentFromTag 只认两值）
            const sentFromTag = isUserText && block ? <SentFromTag sentFrom={block.meta?.sentFrom} /> : null
            // 附件层（图片/文档/引用 chip）：与正文同源 block，挂 bubble header（正文只剩 text）
            const userExtras = isUserText && block ? renderUserBubbleHeader(block, renderCtx) : undefined

            // footer：非终态时结构零改动（只增不改）；终态时在 footer 同排左侧加灰色小标注，
            // UserMessageFooter 包 flex:1 容器——时间戳（marginLeft:auto）仍贴最右，标注占左侧
            const baseFooter = isUserText && block ? (
                <UserMessageFooter
                    text={collectUserText(block.blocks)}
                    createdAt={block.createdAt}
                    canRewind={rewindable}
                    // 移动端：复制/rewind 收进「⋯」菜单，footer 不再重复常驻按钮
                    hideActions={isMobile}
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

            // agent 回复 footer 已移除：复制/fork 操作组移入 turn-result 概要行尾（AgentTurnActions，
            // position A）——时间以概要行为唯一来源，原 footer 悬浮时间戳是重复展示

            // 移动端「⋯」菜单入口（spec 移动端手势仲裁：长按让位给系统文本选择，
            // 原长按菜单整体迁到常驻小按钮，点击等价原长按打开 Drawer）。
            // 挂载范围 = actionsInfo 的 key 集合（用户消息全量；agent 回复仅 fork 落点），
            // 与原长按手势的可作用范围一致；PC 不挂（走 footer hover 操作组）。
            // 位置（2026-09-23 验收定稿）：用户消息进 footer（时间左侧；气泡左侧出血版
            // 验收不过）；agent 回复挂 turn-result 概要行尾（见 turnResultActionsByKey），
            // 不再悬独立行
            const actionsTrigger = isMobile && actionsInfo.has(item.key) && isUserText
                ? <MessageActionsTrigger onClick={() => openActionsByItemKey(item.key)} />
                : null

            // footer 组装：单层 flex 壳（「⋯」入口、终态标注各自可空）→ 既有 footer 内容。
            // 内容槽包 flex:1 容器，保住 UserMessageFooter 时间戳（marginLeft:auto）贴最右
            const terminalLabel = terminalLabelKey !== null ? (
                <span
                    data-testid="user-msg-terminal"
                    // 弱化呈现：token.colorTextTertiary + 小号字（一眼可见但不抢焦）
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: token.colorTextTertiary, fontSize: 11, flexShrink: 0 }}
                >
                    <StopOutlined style={{ fontSize: 11 }} />
                    {t(terminalLabelKey)}
                    {terminalReasonKey && <> · {t(terminalReasonKey)}</>}
                </span>
            ) : null
            // footer：「⋯」（用户消息）+ 终态标注 + 时间戳同排；agent 回复的「⋯」在概要行尾
            const footer = (actionsTrigger || terminalLabel) ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {actionsTrigger}
                    {terminalLabel}
                    <div style={{ flex: 1, minWidth: 0 }}>{baseFooter}</div>
                </div>
            ) : baseFooter

            // 装饰类与 buildBubbleItems 声明的布局类合并，不能覆盖（覆盖会丢 bubble-has-tool 等，
            // 见 buildBubbleItems.bubbleLayoutClass）
            const decorClass = isUserText
                ? 'user-msg-bubble'
                : block?.kind === 'agent-event' && turnResultActionsByKey.has(block.id)
                    ? 'turn-result-bubble'
                    : undefined
            const rootClass = [item.classNames?.root, decorClass].filter(Boolean).join(' ')

            return {
                ...item,
                // header 槽两段堆叠：附件层（图片/文档/引用 chip）在上，跨会话来源标签保序其后
                //（各自可空，全空则 header 保持 undefined 零改动）；UI 来源标记居末（弱化 chip）
                header: (userExtras || showCrossSessionTag || sentFromTag) ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {userExtras}
                        {showCrossSessionTag ? <CrossSessionTag from={crossSessionFrom} turnOrigin={turnOrigin ?? undefined} /> : null}
                        {sentFromTag}
                    </div>
                ) : undefined,
                classNames: rootClass ? { root: rootClass } : undefined,
                footer,
                footerPlacement: 'outer-end' as const,
            }
        })

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
            // lifecycle 终态翻转（queued→cancelled/discarded/refused 广播）不动 block 引用，
            // 但 footer 标注依赖 lifecycleById → 须入签名让缓存失效、footer 随帧重建
            if (isTerminalUserLifecycle(m.lifecycle)) terminalLifecycleCount++
        }
        const ctxKey = `${metadata?.path ?? ''}|${sessionId}|${sendMutation.isPending}|${!!session?.running}`
            + `|${sessionNativeSessionId ?? ''}|${backgroundTasksCount}`
            // 会话激活态入签名：CLI 上/下线翻 canRewind（离线时 rewind RPC 无法送达），入口须随帧刷新
            + `|${session?.active ?? ''}`
            // rewind 状态入签名：dry-run 完成 / executing 翻转时 footer 的 Popover 内容须重建；
            // rewindBusy 翻转（受理/终态）翻 canRewind，footer/「⋯」菜单入口须随帧刷新
            + `|${rewindDraft?.messageId ?? ''}|${rewindDraft?.source ?? ''}|${rewindDryRun?.canRewind ?? ''}-${rewindDryRun?.canRestoreFiles ?? ''}|${rewindExecuting}`
            + `|${rewindBusy}`
            // 链首骨架翻转（窗口到头 / 历史补齐）翻 canRewind，入口须随帧刷新；unk = 不可判定
            + `|${chainHeadIds === null ? 'unk' : chainHeadIds.size}`
            // metadata 签名：ack/attach 补写后 rewind 图标即时刷新（而非「刷新才见」）
            + `|${nativeIdCount}-${nativeSidCount}-${nativeAckCount}`
            // 上下文边界指针入签名：compact/clear 推进 contextBoundarySeq 翻 canRewind（边界前旧行入口隐藏），footer 须随帧刷新
            + `|${metadata?.contextBoundarySeq ?? ''}`
            // lifecycle 终态签名：cancelled/discarded/refused 广播到达后标注即时出现（而非「刷新才见」）
            + `|${terminalLifecycleCount}`
            // fork 状态入签名：会话模式 / 溯源字段翻 canFork；fork Popover 激活与执行中翻转时 footer 内容须重建
            + `|${session?.mode ?? ''}|${metadata?.forkedFrom ? 1 : 0}-${metadata?.forkFrom ? 1 : 0}`
            + `|${forkDraft?.source === 'popover' ? forkDraft.messageId ?? '' : ''}|${forkPending}`
        const reusableCache = prevItemsRef.current.ctxKey === ctxKey
            ? prevItemsRef.current.cache
            : new Map()
        const { items, cache } = reconcileBubbleItems(decorated, reusableCache)
        prevItemsRef.current = { cache, ctxKey }
        return items
    }, [chatBlocks, errorCardContext, session?.running, session?.active, session?.mode, metadata, api, sessionId, sendMutation.isPending, t, messages, sessionNativeSessionId, backgroundTasksCount, rewindBusy, chainHeadIds, handleOpenRewind, rewindDraft, rewindDryRun, rewindExecuting, confirmRewind, cancelRewind, openForkPopover, forkPending, confirmFork, cancelFork, forkDraft, isMobile, handleEditSketchFromBubble, rewindCompletion])

    const bubbleItems = useMemo(() => {
        // 列表尾部的「系统动作行」：命令进行中（compact/clear/rewind）、缓存过期提示、
        // 运行指示（AgentLoadingBubble——running 且未在 compact；compact 期间已由
        // CommandProgressBubble 表达同一件事，两者不并排）
        const cacheStatus = session?.runtimeState?.cacheStatus
        const showCacheRow = cacheStatus != null && cacheStatus.expired
        const showLoading = Boolean(session?.running) && !isCompressing
        // 无尾行时直接复用 decoratedItems 引用，不做无意义的数组拷贝
        if (!isCompressing && !isClearing && !isRewinding && !showCacheRow && !showLoading && !showStatusPills) {
            return decoratedItems
        }

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

        // 缓存过期提示在运行指示之前：它描述「这一轮将要发生什么」的前提
        if (showCacheRow) {
            items.push({
                key: '__cache_expired__',
                role: 'assistant',
                content: <CacheExpiredRow cacheStatus={cacheStatus} />,
                variant: 'borderless',
            })
        }

        if (showLoading) {
            items.push({
                key: '__loading__',
                role: 'assistant',
                content: (
                    <AgentLoadingBubble
                        agentId={sessionId}
                        status={getAgentStatus({
                            active: session?.active ?? false,
                            running: true,
                            agentState: session?.agentState,
                        })}
                        lastActivityAt={activityAtSecond}
                        startedAt={runStartedAt}
                        toolRunning={hasRunningTool}
                    />
                ),
                variant: 'borderless',
            })
        }

        // 状态气泡浮层让位：贴底时最后一条消息停在气泡上方，不被毛玻璃气泡盖住
        if (showStatusPills) {
            items.push({
                key: '__status_pills_spacer__',
                role: 'assistant',
                content: STATUS_PILLS_SPACER,
                variant: 'borderless',
                classNames: { root: 'bubble-status-spacer' },
            })
        }

        return items
    }, [
        decoratedItems, isCompressing, isClearing, isRewinding,
        session?.running, session?.active, session?.agentState, session?.runtimeState?.cacheStatus,
        sessionId, activityAtSecond, runStartedAt, showStatusPills, hasRunningTool,
    ])

    // 入参为 composer 完整分段；wire blocks（serializeSegments）由 useSendMessage 内部统一序列化。
    // 空分段防御性拦截（正常路径由 composer canSend 保证）
    const handleSend = (segments: ComposerSegments) => {
        if (import.meta.env.DEV) console.log('[Send] handleSend', { textLen: segments.text.length })
        if (isSegmentEmpty(segments)) return
        // 待激活分叉会话（spec §4.3「首条消息激活」）：composer 放行后消息照常入队，
        // 但需先触发 resume spawn——CLI 绑定 fork 行并消费激活协议后才会消费队列。
        // resume 失败不拦截入队：消息保持 queued，重试路径直接消费（spec §5.3「重发即重试」）
        if (isPendingFork && !session?.active) {
            void sessionActions.resumeSession().catch(() => {})
        }
        sendMutation.mutate(segments)
        if (import.meta.env.DEV) console.log('[Send] sendMutation.mutate 已调用')
    }

    // UI 回灌（generative-ui 回路②③）：fenced openui 块与沙箱 app bridge 发出的消息走
    // 同一 sendMutation（乐观气泡/排队轨道/rewind 清除/daemon intake 与手打完全同链路）。
    // 这里是 web 层 origin/anchor 词汇到 wire 字段（sentFrom/sourceBlock）的唯一映射点；
    // 合法值在 shared UiMessageOrigin（单一来源）。用 stableMutateAsync 并透传 promise——
    // 档③据此在发送失败时回滚乐观 running（dep 用稳定的底层引用，useSendMessage 已
    // useCallback/ref 桥化；包装对象本身每渲染新建，不能作 dep——流式期间每个 delta
    // 会击穿懒 chunk 的 memo），保证 context value 引用稳定。
    const sendUiMutateAsync = sendMutation.mutateAsync
    const sendUiMessage = useCallback((text: string, opts: { origin: UiMessageOrigin; anchor?: string; formState?: Record<string, unknown>; stateVar?: string }) =>
        // then(void 化)：UI 回灌不消费响应体，UiSendMessage 契约只关心成败
        sendUiMutateAsync({ ...emptySegments(), text }, { sentFrom: opts.origin, sourceBlock: opts.anchor, formState: opts.formState, stateVar: opts.stateVar })
            .then(() => undefined),
    [sendUiMutateAsync])

    // 档③终态推进（票 04）：接线收口在 openui 目录（useOpenUIActionLifecycle），
    // 此处只喂数据——消息窗口 + 会话运行态（本组件 key={sessionId} 挂载，切会话即
    // 重建实例，跨会话的 store 清理由 hook 卸载 cleanup 承担，见其内部注释）
    useOpenUIActionLifecycle(messages, session?.running ?? false)

    const handleAbort = async (stopKind: StopKind) => {
        await sessionActions.abortSession(stopKind)
    }

    // 状态气泡详情里的清理动作（todo/task 清单、前台/后台任务、团队成员）
    const handleClearRuntimeState = useCallback(
        async (clearSessionId: string, clearFields: ClearRuntimeStateField[]) => {
            await api.sessions.clearRuntimeStateFields(clearSessionId, clearFields)
        },
        [api],
    )

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

    // 动作派发：只在点击时执行，经 ref 取最新闭包，避免把整条消息装配链的 memo 拖垮
    errorActionRef.current = (action, blockId) => {
        const target = precedingUserTextBlock(chatBlocks, blockId)
        switch (action) {
            case 'retry': {
                const text = target ? collectUserText(target.blocks) : ''
                if (text) handleSend({ ...emptySegments(), text })
                break
            }
            case 'compact':
                handleSend({ ...emptySegments(), text: COMPACT_COMMAND })
                break
            case 'rewind': {
                const nativeId = target ? messages.find((m) => m.id === target.id)?.metadata?.nativeId : null
                if (target && nativeId) {
                    // 移动端 footer 走 hideActions、不挂受控 Popover（确认视图在 MessageActionsDrawer 里），
                    // modal 来源在移动端没有承载物；指定「⋯」目标并改为 drawer 来源，抽屉直接落在回退确认
                    if (isMobile) {
                        setActionsTarget(actionsInfoByRef.current.get(target.id) ?? null)
                        void openRewindDialog(nativeId, 'drawer')
                    } else {
                        handleOpenRewind(target.id, nativeId)
                    }
                }
                break
            }
            case 'resume':
                void sessionActions.resumeSession().catch(() => messageApi.error(t('chat.error.resumeFailed')))
                break
            case 'switchModel':
                if (errorFallbackModel) {
                    void handleModelChange(errorFallbackModel)
                        .catch(() => messageApi.error(t('chat.error.switchModelFailed')))
                }
                break
            case 'newSession':
                void navigate({ to: '/sessions/new', search: { workspaceId: session?.workspaceId ?? undefined } })
                break
            case 'reauth':
                // 鉴权失败来自模型供应商，重新登录要在终端 CLI 里做（web 的 /login 是另一套登录）
                void copyTextToClipboard(REAUTH_COMMAND)
                    .then(() => messageApi.success(t('chat.error.reauthCopied')))
                    .catch(() => {})
                break
            // copyDetails 由卡片的「详情」折叠区承载，不派发动作
        }
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
        // 全屏浮层挂载层：全宽（不受 CHAT_MAX_WIDTH 限宽），画板全屏时撑满整个内容区
        // （红框区域）；内层聊天列保持 1200 居中不受影响
        // data-perf-region：dev-only layout-shift 归因观测器（core/lib/layoutShiftObserver）消费
        // UI 回灌 provider：覆盖消息列表 + composer，fenced openui 块与 app bridge 深处的回灌经此发出
        <UiSendProvider sendMessage={sendUiMessage}>
        <div ref={setChatFullscreenEl} style={{ position: 'relative', height: '100%', width: '100%' }} data-perf-region="chat">
            <div
                style={{ display: 'flex', flexDirection: 'column', height: '100%', maxWidth: CHAT_MAX_WIDTH, width: '100%', margin: '0 auto', position: 'relative' }}
            >
            {contextHolder}
            <Global styles={bubbleCopyStyles} />
            <Global styles={chatScrollStyles} />
            <Global styles={collapsibleUserMessageStyles} />
            <Global styles={quoteFlashStyles} />
            <div
                ref={setChatScrollEl}
                className="chat-scroll-container"
                style={{ flex: 1, overflow: 'hidden', padding: CHAT_SCROLL_PADDING, fontFamily: 'var(--font-chat)', position: 'relative' }}
                onMouseUp={isMobile ? undefined : handleSelectionMouseUp}
            >
                {/* 空会话但有尾行（运行指示 / 缓存过期 / 气泡让位）时也要挂列表：
                    这些行属于聊天流，只挂 ChatWelcome 会让它们在首条消息落库前整段不可见 */}
                {chatBlocks.length === 0 && bubbleItems.length === 0 ? (
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
                                // 状态气泡在场时上移，避免与气泡行叠在一起（几何与让位 spacer 同源）
                                bottom: showStatusPills ? STATUS_PILLS_SPACER_HEIGHT + 8 : 32,
                                zIndex: 10,
                                // 容器不挡点击，按钮自身恢复
                                pointerEvents: 'none',
                            }}
                        >
                            {/* 原 circle 钮（antd default 白底描边）→ IconButton circle+default：icon-only 归 D4，形态归本组件 */}
                            <IconButton
                                size={36}
                                circle
                                variant="default"
                                // running 时换用 loading 图标：用户滚离底部时仍能感知「正在生成」，点击回到底部查看
                                icon={session?.running ? <LoadingOutlined /> : <DownOutlined />}
                                aria-label={t('common.scrollBottom')}
                                onClick={handleScrollToBottom}
                                style={{
                                    pointerEvents: 'auto',
                                    boxShadow: token.boxShadowSecondary,
                                }}
                            />
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* 状态气泡浮层：浮在聊天区底部（composer 上方、dock 之外）。
                    上滚时消息从毛玻璃后面穿过；贴底时列表尾部的 spacer 已让出气泡高度 */}
                <ComposerStatusPills
                    summary={statusSummary}
                    presence={statusPresence}
                    todos={statusTodos}
                    tasks={statusTasks}
                    sessionId={sessionId}
                    api={api}
                    onOpenToolUseId={taskDrawer.openToolUseId}
                    onClear={handleClearRuntimeState}
                />
            </div>

            {/* 选区引用浮层：fixed 定位锚定选区几何（放滚动容器外——它随滚动关闭而非跟随）；
                评论输入是「添加到对话」的第二步，同族同定位 */}
            {quotePopover && (
                <QuoteSelectionPopover
                    state={quotePopover}
                    onAdd={handleQuoteAdd}
                    onClose={() => setQuotePopover(null)}
                />
            )}
            {quoteCommentDraft && (
                <>
                    {/* 选区 ghost：原生选区已被输入框夺焦清掉，用冻结 rects 保持选中观感。
                        键盘弹出后视口被压缩、冻结坐标全部失效（会糊到 composer 上），隐藏 */}
                    {!kbInset && <SelectionGhost rects={quoteCommentDraft.rects} />}
                    <QuoteCommentInput
                        initialComment={quoteCommentDraft.initialComment}
                        rect={quoteCommentDraft.rect}
                        onSave={handleQuoteCommentSave}
                        onClose={handleQuoteCommentClose}
                    />
                </>
            )}

            {/* 移动端消息操作菜单（气泡 footer「⋯」入口打开，原长按入口已迁移）：
                用户消息 → 复制/回退并编辑；agent 回复落点 → 复制/从此分叉（fork-session spec §4.2） */}
            {isMobile && (
                <MessageActionsDrawer
                    open={actionsTarget !== null}
                    target={actionsTarget}
                    rewindActive={rewindDraft?.source === 'drawer' && actionsTarget !== null}
                    forkActive={forkDraft?.source === 'drawer' && actionsTarget !== null}
                    dryRun={rewindDryRun}
                    loading={rewindExecuting || forkPending}
                    onClose={() => {
                        setActionsTarget(null)
                        setRewindDraft(null)
                        setRewindDryRun(null)
                        setForkDraft(null)
                    }}
                    onRewind={(nativeId) => { void openRewindDialog(nativeId, 'drawer') }}
                    onConfirmRewind={(restoreFiles) => { void confirmRewind(restoreFiles) }}
                    onCancelRewind={() => {
                        setRewindDraft(null)
                        setRewindDryRun(null)
                    }}
                    onFork={(anchorNativeId) => {
                        // 移动端入口：锚点来自「⋯」目标，预览文本取 Drawer 选中消息原文
                        setForkDraft({ anchorNativeId, source: 'drawer', targetText: actionsTarget?.text ?? null })
                    }}
                    onConfirmFork={() => { void confirmFork() }}
                    onCancelFork={() => {
                        setForkDraft(null)
                    }}
                />
            )}

        {/* composer stacking（z 102）高于画板浮层（z 101）：开合为滑沉消隐（不发生
            穿越位移），z 序只为维持 stacking 阶梯（见 sketchLayout）；全屏形态浮层升 103 */}
        <div style={{ position: 'relative', zIndex: SKETCH_Z_COMPOSER }}>
            <ChatComposer
                ref={composerHandleRef}
                onQuoteLocate={handleQuoteLocate}
                sketchLayerEl={chatFullscreenEl}
                sketchDockMetrics={sketchDockMetrics}
                sessionId={sessionId}
                draftRequest={draftRequest}
                disabled={sendMutation.isPending || isCompressing || isRewinding || (isClearing && !clearStuck)}
                sending={sendMutation.isPending}
                clearInProgress={isClearing}
                // 当前值以 runtimeState 为权威（keep-alive 实时上报，切换后 ≤2s 刷新）；
                // sdkMetadata.outputStyle 是 init 时快照，而 init 先于 applyFlagSettings，
                // 会系统性滞后于实际生效值，仅作老会话兜底
                outputStyle={session?.runtimeState?.outputStyle ?? session?.metadata?.sdkMetadata?.outputStyle}
                availableOutputStyles={session?.metadata?.sdkMetadata?.availableOutputStyles}
                permissionMode={session?.permissionMode}
                model={session?.runtimeState?.model}
                active={session?.active ?? false}
                // 休眠/待激活会话放行 composer（dormancy spec §B：发消息即唤醒，daemon 入队后
                // 服务端触发 spawn，web 无需先做「恢复」动作）；唤醒首响应慢几秒是唯一感知
                allowSendWhenInactive
                running={session?.running ?? false}
                agentState={session?.agentState}
                metadata={metadata}
                agentFlavor={agentFlavor}
                mode={session?.mode}
                workingDir={session?.metadata?.path}
                effort={session?.runtimeState?.effort}
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

            {/* 状态气泡详情里的任务卡片 → 工具详情抽屉（前台 Agent / 后台任务共用） */}
            {taskDrawer.drawerBlock && (
                <ToolDetailDrawer
                    block={taskDrawer.drawerBlock}
                    metadata={metadata}
                    open={!!taskDrawer.drawerBlock}
                    onClose={taskDrawer.close}
                    sessionId={sessionId}
                />
            )}
        </div>
            </div>
        </div>
        </UiSendProvider>
    )
}
