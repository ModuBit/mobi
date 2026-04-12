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

import { useRef, useEffect, useMemo } from 'react'
import { Bubble } from '@ant-design/x'
import { Spin, Empty, theme as antTheme } from 'antd'
import { useTranslation } from 'react-i18next'
import { useMessages } from '@/hooks/queries/useMessages'
import { useSession } from '@/hooks/queries/useSession'
import { useSendMessage } from '@/hooks/mutations/useSendMessage'
import { useSessionActions } from '@/hooks/mutations/useSessionActions'
import { parseMessages } from './messageParser'
import { ToolCallBlock, ToolResultBlock } from './ToolResultBlock'
import { PermissionRequest } from './PermissionRequest'
import { ChatComposer } from '@/components/composer/ChatComposer'
import { XMarkdown } from '@ant-design/x-markdown'

import type { ParsedMessage, ParsedContentBlock } from './messageParser'

const { useToken } = antTheme

// Bubble.List role 配置
const BUBBLE_ROLES = {
    assistant: {
        placement: 'start' as const,
        variant: 'borderless' as const,
    },
    user: {
        placement: 'end' as const,
    },
}

interface ChatContainerProps {
    sessionId: string
}

export function ChatContainer({ sessionId }: ChatContainerProps) {
    const { data: messages = [], isLoading: messagesLoading } = useMessages(sessionId)
    const { data: session } = useSession(sessionId)
    const sendMutation = useSendMessage(sessionId)
    const sessionActions = useSessionActions(sessionId)
    const bottomRef = useRef<HTMLDivElement>(null)
    const { token } = useToken()
    const { t } = useTranslation()

    // 解析所有消息
    const parsedMessages = useMemo(() => {
        return parseMessages(messages)
    }, [messages])

    // 将 ParsedMessage 转换为 Bubble 列表项
    // 每个 ParsedMessage 的 content 数组中的每个块都会生成一个 Bubble
    // 注意：过滤掉 system 角色的消息，它们用于显示事件（如 API 错误、耗时）
    const bubbleItems = useMemo(() => {
        const items: Array<{
            key: string
            role: 'assistant' | 'user'
            content: React.ReactNode
            typing?: boolean
        }> = []

        for (const msg of parsedMessages) {
            // 跳过 system 消息
            if (msg.role === 'system') continue

            // 为每个 content block 创建一个 bubble
            for (let i = 0; i < msg.content.length; i++) {
                const block = msg.content[i]
                const blockKey = `${msg.id}-${i}`
                const content = renderContentBlock(block, token)

                if (content !== null) {
                    items.push({
                        key: blockKey,
                        role: msg.role,
                        content,
                        // 只有 assistant 的最后一个文本块在 thinking 时显示打字效果
                        typing: msg.role === 'assistant' &&
                            block.type === 'text' &&
                            i === msg.content.length - 1 &&
                            session?.thinking,
                    })
                }
            }
        }

        return items
    }, [parsedMessages, session?.thinking, token])

    // 自动滚动到底部
    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [bubbleItems.length])

    // 发送消息
    const handleSend = (text: string) => {
        if (!text.trim()) return
        sendMutation.mutate(text)
    }

    // 中断会话
    const handleAbort = async () => {
        await sessionActions.abortSession()
    }

    // 权限模式变更
    const handlePermissionModeChange = async (mode: string) => {
        await sessionActions.setPermissionMode(mode)
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
            {/* 消息列表 */}
            <div style={{ flex: 1, overflow: 'auto', padding: '16px 8px' }}>
                {parsedMessages.length === 0 ? (
                    <Empty description={t('chat.empty')} style={{ marginTop: 40 }} />
                ) : (
                    <>
                        <Bubble.List
                            items={bubbleItems}
                            role={BUBBLE_ROLES}
                            style={{ height: '100%' }}
                        />
                        {session?.thinking && (
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
                <div ref={bottomRef} />
            </div>

            {/* 权限请求提示 */}
            <PermissionRequest
                sessionId={sessionId}
                session={session}
            />

            {/* Composer 输入组件 */}
            <ChatComposer
                disabled={sendMutation.isPending}
                permissionMode={session?.permissionMode}
                model={session?.runtimeState?.model}
                active={session?.active ?? false}
                allowSendWhenInactive
                thinking={session?.thinking ?? false}
                agentState={session?.agentState}
                contextSize={undefined} // TODO: 从消息中计算上下文大小
                agentFlavor={agentFlavor}
                onPermissionModeChange={handlePermissionModeChange}
                onSend={handleSend}
                onAbort={handleAbort}
            />
        </div>
    )
}

// 渲染内容块
function renderContentBlock(block: ParsedContentBlock, token: ReturnType<typeof useToken>['token']): React.ReactNode {
    switch (block.type) {
        case 'text':
            return (
                <div style={{ maxWidth: '100%' }}>
                    <XMarkdown content={block.text || ''} />
                </div>
            )
        case 'reasoning':
            return (
                <div style={{
                    padding: '8px 12px',
                    background: token.colorWarningBg,
                    border: `1px solid ${token.colorWarningBorder}`,
                    borderRadius: 4,
                    fontSize: 12,
                    color: token.colorWarningText,
                    fontStyle: 'italic'
                }}>
                    💭 {block.text}
                </div>
            )
        case 'tool-call':
            return <ToolCallBlock block={block} />
        case 'tool-result':
            return <ToolResultBlock block={block} />
        case 'summary':
            return (
                <div style={{
                    padding: '8px 12px',
                    background: token.colorInfoBg,
                    border: `1px solid ${token.colorInfoBorder}`,
                    borderRadius: 4,
                    fontSize: 12,
                    color: token.colorInfoText
                }}>
                    📝 {block.summary}
                </div>
            )
        case 'event':
            return (
                <div style={{
                    padding: '8px 12px',
                    background: token.colorBgContainer,
                    borderRadius: 4,
                    fontSize: 12,
                    color: token.colorTextSecondary
                }}>
                    {formatEvent(block.event)}
                </div>
            )
        default:
            return null
    }
}

// 格式化事件
function formatEvent(event: { type: string; [key: string]: unknown }): string {
    // 注意：这里的翻译需要通过 t() 函数，但由于这是纯函数，暂时保留硬编码
    // TODO: 考虑重构为 React 组件以支持翻译
    switch (event.type) {
        case 'api-error':
            return `❌ API Error (Retry ${event.retryAttempt}/${event.maxRetries})`
        case 'turn-duration':
            return `⏱️ Duration: ${event.durationMs}ms`
        default:
            return `📌 ${event.type}`
    }
}
