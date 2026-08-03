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
import { Spin, Button, theme as antTheme, message } from 'antd'
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
import { buildChatBubbleItems } from './buildBubbleItems'
import { BubbleListChat, type BubbleListChatHandle, type ChatBubbleItem } from './BubbleListChat'
import { reconcileBubbleItems, type BubbleItemsCache } from './reconcileBubbleItems'
import { ChatComposer } from '@/components/composer/ChatComposer'
import { CommandProgressBubble } from './CommandProgressBubble'
import { isCommandInProgress, isClearInProgress, isCompactCompletion, COMPACT_COMMAND } from '@/domain/chat/presentation'
import { ChatWelcome } from './ChatWelcome'
import { CopyButton } from './CopyButton'
import { useMobiApi } from '@/core/data/api/client'
import type { ActionItem } from '@/components/composer/ResponsiveActionBar'
import type { SessionMetadataSummary } from '@/core/data/api/types'
import { useRunningAgentsStore } from '@/core/data/stores/runningAgentsStore'
import { useBackgroundTasksStore } from '@/core/data/stores/backgroundTasksStore'
import { useChatBlocksByIdStore } from '@/core/data/stores/chatBlocksByIdStore'
import { useTeamAgentsStore } from '@/core/data/stores/teamAgentsStore'
import { collapsibleUserMessageStyles } from './CollapsibleUserMessage'

// BUBBLE_ROLES 由 BubbleListChat 内部使用（from './bubbleRoles'），此处仅保留 re-export
// 供历史 import './ChatContainer' 的调用方兼容
export { BUBBLE_ROLES } from './bubbleRoles'

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

    const handleScrollToBottom = useCallback(() => {
        chatListRef.current?.scrollToBottom('smooth')
    }, [])

    // 传给 BubbleListChat 的稳定回调：内联箭头每次渲染换引用，会让其内部
    // 上抛 following 的 effect 每帧重跑
    const handleFollowingChange = useCallback((following: boolean) => {
        setShowScrollBottom(!following)
    }, [])

    const decoratedItems = useMemo(() => {
        const baseItems = buildChatBubbleItems(
            chatBlocks,
            { metadata, isThinking: false, api, sessionId, disabled: sendMutation.isPending },
            !!session?.running,
            { contextResetLabel: t('chat.contextReset') },
        )

        const decorated: ChatBubbleItem[] = baseItems.map(item => {
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

        // 结构化共享：block 未变的 item 复用上一帧对象（连同其 content 元素），
        // 让 BubbleItem 的 memo 真正生效。
        //
        // 缓存自失效：content 由 block + 渲染上下文共同决定，上下文变了必须整体重建，
        // 否则会复用捕获了旧 ctx（旧 disabled / 旧 api）的 content。这里把上下文签名
        // 与缓存存在一起比对——签名不同则丢弃缓存，从空 Map 重建。
        const ctxKey = `${metadata?.path ?? ''}|${sessionId}|${sendMutation.isPending}|${!!session?.running}`
        const reusableCache = prevItemsRef.current.ctxKey === ctxKey
            ? prevItemsRef.current.cache
            : new Map()
        const { items, cache } = reconcileBubbleItems(decorated, reusableCache)
        prevItemsRef.current = { cache, ctxKey }
        return items
    }, [chatBlocks, session?.running, metadata, api, sessionId, sendMutation.isPending, t])

    const bubbleItems = useMemo(() => {
        // 无进行中命令时直接复用 decoratedItems 引用，不做无意义的数组拷贝
        if (!isCompressing && !isClearing) return decoratedItems

        const items: ChatBubbleItem[] = [...decoratedItems]

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
    }, [decoratedItems, isCompressing, isClearing])

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
            <Global styles={chatScrollStyles} />
            <Global styles={collapsibleUserMessageStyles} />
            <div className="chat-scroll-container" style={{ flex: 1, overflow: 'hidden', padding: '8px 8px', fontFamily: 'var(--font-chat)', position: 'relative' }}>
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

            <ChatComposer
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
