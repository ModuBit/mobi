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
import { Spin, Empty, Button, theme as antTheme } from 'antd'
import { DownOutlined } from '@ant-design/icons'
import { Global, css } from '@emotion/react'
import { useTranslation } from 'react-i18next'
import { useMessages } from '@/core/data/hooks/queries/useMessages'
import { useSession } from '@/core/data/hooks/queries/useSession'
import { useSendMessage } from '@/core/data/hooks/mutations/useSendMessage'
import { useSessionActions } from '@/core/data/hooks/mutations/useSessionActions'
import { reduceChatBlocks, normalizeDecryptedMessage, hasBashTags } from '@/domain/chat'
import { formatMessageTime } from '@/core/utils/timeFormat'
import { renderChatBlock } from './blocks'
import { ChatComposer } from '@/components/composer/ChatComposer'
import { CopyButton } from './CopyButton'
import { useAuthStore } from '@/core/data/stores/authStore'
import { useMobiApi } from '@/core/data/api/client'
import type { ActionItem } from '@/components/composer/ResponsiveActionBar'
import type { SessionMetadataSummary } from '@/core/data/api/types'

const { useToken } = antTheme

/** assistant 角色 block kinds */
const ASSISTANT_BLOCK_KINDS = new Set(['agent-text', 'agent-reasoning', 'tool-call', 'compact-summary'])

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

// Bubble.List role 配置
const BUBBLE_ROLES = {
    assistant: {
        placement: 'start' as const,
        variant: 'borderless' as const,
    },
    user: {
        placement: 'end' as const,
    },
    system: {
        variant: 'borderless' as const,
        styles: { content: { paddingBlock: 0, minHeight: 'auto' } },
    },
}

interface ChatContainerProps {
    sessionId: string
    /** 传递给 ChatComposer 的额外按钮（已废弃，请使用 extraComposerItems） */
    extraComposerButtons?: React.ReactNode
    /** 传递给 ChatComposer 的额外操作项 */
    extraComposerItems?: ActionItem[]
}

export function ChatContainer({ sessionId, extraComposerButtons, extraComposerItems }: ChatContainerProps) {
    const { data: messages = [], isLoading: messagesLoading } = useMessages(sessionId)
    const { data: session } = useSession(sessionId)
    const sendMutation = useSendMessage(sessionId)
    const sessionActions = useSessionActions(sessionId)
    const scrollContainerRef = useRef<HTMLDivElement>(null)
    const scrollBoxRef = useRef<HTMLElement | null>(null)
    const [showScrollBottom, setShowScrollBottom] = useState(false)
    const { token } = useToken()
    const { t } = useTranslation()
    const { token: authToken } = useAuthStore()
    const api = useMobiApi(authToken)

    // 工具渲染所需的元数据
    const metadata = (session?.metadata ?? null) as SessionMetadataSummary | null

    // 使用 reduceChatBlocks 处理消息（包含 CLI 输出合并）
    const { blocks: chatBlocks } = useMemo(() => {
        // 先标准化消息，然后归约为聊天块
        const normalized = messages
            .map(normalizeDecryptedMessage)
            .filter((m): m is Exclude<typeof m, null> => m !== null)
        return reduceChatBlocks(normalized, session?.agentState)
    }, [messages, session?.agentState])

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
            setShowScrollBottom(scrollBox.scrollTop < -20)
        }

        scrollBox.addEventListener('scroll', handleScroll, { passive: true })
        return () => scrollBox.removeEventListener('scroll', handleScroll)
    }, [chatBlocks.length])

    // 自动滚动到底部
    useEffect(() => {
        scrollBoxRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
    }, [chatBlocks.length])

    // 手动跳到底部
    const handleScrollToBottom = useCallback(() => {
        scrollBoxRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
    }, [])

    const bubbleItems = useMemo(() => {
        const items: Array<{
            key: string
            role: 'assistant' | 'user' | 'system'
            content: React.ReactNode
            typing?: boolean
            variant?: 'borderless'
            header?: React.ReactNode
            footer?: React.ReactNode
            footerPlacement?: 'inner-start' | 'inner-end' | 'outer-start' | 'outer-end'
            classNames?: { root?: string }
        }> = []

        // 用于判断是否是最后一个 assistant 块（typing 动画）
        let lastAssistantBlockKey: string | null = null
        for (let i = chatBlocks.length - 1; i >= 0; i--) {
            const block = chatBlocks[i]
            if (block.kind === 'agent-text' || block.kind === 'agent-reasoning') {
                lastAssistantBlockKey = block.id
                break
            }
        }

        for (let i = 0; i < chatBlocks.length; i++) {
            const block = chatBlocks[i]
            const nextBlock = chatBlocks[i + 1]

            // bash 模式：跳过紧跟 bash cli-output 之前的用户消息（如 '! tree .'）
            if (
                block.kind === 'user-text'
                && nextBlock?.kind === 'cli-output'
                && hasBashTags((nextBlock as { text: string }).text)
            ) {
                continue
            }

            // 是否为最后一个 assistant block 且 session 正在运行
            const isLastRunningBlock = block.id === lastAssistantBlockKey && !!session?.running
            // 流式光标仅对 snapshot 生效（snapshot 字段由 Hub 透传）
            const isSnapshot = (block.kind === 'agent-text' || block.kind === 'agent-reasoning') && block.isSnapshot

            const content = renderChatBlock(
                isLastRunningBlock && isSnapshot
                    ? { ...block, isStreaming: true }
                    : block,
                {
                    metadata,
                    isThinking: block.kind === 'agent-reasoning' && isLastRunningBlock,
                    api,
                    sessionId,
                    disabled: sendMutation.isPending,
                }
            )
            if (content === null) continue

            // 确定角色
            let role: 'assistant' | 'user' | 'system' = 'user'
            if (ASSISTANT_BLOCK_KINDS.has(block.kind)) {
                role = 'assistant'
            } else if (block.kind === 'agent-event') {
                role = 'system'
            } else if (block.kind === 'cli-output') {
                // bash 模式输出始终用 assistant 角色渲染
                role = (block.source === 'assistant' || hasBashTags(block.text)) ? 'assistant' : 'user'
            }

            // 判断是否需要 typing 动画
            const isTyping = role === 'assistant' &&
                (block.kind === 'agent-text' || block.kind === 'agent-reasoning') &&
                isLastRunningBlock

            items.push({
                key: block.id,
                role,
                content,
                typing: isTyping,
                variant: (role === 'system' || role === 'assistant') ? 'borderless' : undefined,
                header: block.kind === 'user-text' ? (
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        <div className="msg-copy-btn">
                            <CopyButton text={block.text} size={16} />
                        </div>
                    </div>
                ) : undefined,
                classNames: block.kind === 'user-text' ? { root: 'user-msg-bubble' } : undefined,
                footer: block.kind === 'user-text' ? (
                    <span style={{ fontSize: 11, opacity: 0.6 }}>{formatMessageTime(block.createdAt)}</span>
                ) : undefined,
                footerPlacement: 'outer-end',
            })
        }

        return items
    }, [chatBlocks, session?.running, token, t, metadata])

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
                        {session?.running && (
                            <div style={{ padding: '8px 16px' }}>
                                <Bubble
                                    placement="start"
                                    variant="borderless"
                                    loading
                                    content=""
                                />
                            </div>
                        )}
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
