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
import { Bubble, Sender } from '@ant-design/x'
import { Spin, Typography, Empty, Avatar } from 'antd'
import { useMessages } from '@/hooks/queries/useMessages'
import { useSession } from '@/hooks/queries/useSession'
import { useSendMessage } from '@/hooks/mutations/useSendMessage'
import { parseMessages } from './messageParser'
import { ToolCallBlock, ToolResultBlock } from './ToolResultBlock'
import { PermissionRequest } from './PermissionRequest'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import type { ParsedMessage, ParsedContentBlock } from './messageParser'

const { Text } = Typography

// AI 机器人头像组件
const AI_AVATAR = <Avatar style={{ background: '#1677ff' }}>🤖</Avatar>

// Bubble.List role 配置
const BUBBLE_ROLES = {
    assistant: {
        placement: 'start' as const,
        avatar: AI_AVATAR,
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
    const bottomRef = useRef<HTMLDivElement>(null)

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
                const content = renderContentBlock(block)

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
    }, [parsedMessages, session?.thinking])

    // 自动滚动到底部
    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [bubbleItems.length])

    const handleSend = (text: string) => {
        if (!text.trim()) return
        sendMutation.mutate(text)
    }

    if (messagesLoading) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
                <Spin tip="加载中..." />
            </div>
        )
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            {/* 消息列表 */}
            <div style={{ flex: 1, overflow: 'auto', padding: '16px 8px' }}>
                {parsedMessages.length === 0 ? (
                    <Empty description="暂无消息" style={{ marginTop: 40 }} />
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
                                    loading
                                    avatar={AI_AVATAR}
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

            {/* 输入框 */}
            <div style={{ padding: '8px 16px', borderTop: '1px solid #f0f0f0', background: '#fff' }}>
                <Sender
                    onSubmit={handleSend}
                    loading={sendMutation.isPending || session?.thinking}
                    placeholder="输入消息... (Shift+Enter 换行)"
                    disabled={!session?.active}
                />
                {!session?.active && (
                    <Text type="secondary" style={{ fontSize: 12, display: 'block', textAlign: 'center', marginTop: 4 }}>
                        会话已结束
                    </Text>
                )}
            </div>
        </div>
    )
}

// 渲染内容块
function renderContentBlock(block: ParsedContentBlock): React.ReactNode {
    switch (block.type) {
        case 'text':
            return (
                <div style={{ maxWidth: '100%' }}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {block.text || ''}
                    </ReactMarkdown>
                </div>
            )
        case 'reasoning':
            return (
                <div style={{
                    padding: '8px 12px',
                    background: '#fff7e6',
                    border: '1px solid #ffd591',
                    borderRadius: 4,
                    fontSize: 12,
                    color: '#873800',
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
                    background: '#e6f7ff',
                    border: '1px solid #91d5ff',
                    borderRadius: 4,
                    fontSize: 12,
                    color: '#0050b3'
                }}>
                    📝 {block.summary}
                </div>
            )
        case 'event':
            return (
                <div style={{
                    padding: '8px 12px',
                    background: '#f5f5f5',
                    borderRadius: 4,
                    fontSize: 12,
                    color: '#666'
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
    switch (event.type) {
        case 'api-error':
            return `❌ API 错误 (重试 ${event.retryAttempt}/${event.maxRetries})`
        case 'turn-duration':
            return `⏱️ 耗时: ${event.durationMs}ms`
        default:
            return `📌 ${event.type}`
    }
}
