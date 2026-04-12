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
import { Bubble, Think } from '@ant-design/x'
import { Spin, Empty, Button, theme as antTheme } from 'antd'
import { DownOutlined } from '@ant-design/icons'
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
    system: {
        variant: 'borderless' as const,
        styles: { content: { paddingBlock: 0, minHeight: 'auto' } },
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
    const scrollContainerRef = useRef<HTMLDivElement>(null)
    const [showScrollBottom, setShowScrollBottom] = useState(false)
    const { token } = useToken()
    const { t } = useTranslation()

    // 解析所有消息
    const parsedMessages = useMemo(() => {
        return parseMessages(messages)
    }, [messages])

    // 监听 Bubble.List 内部滚动容器的滚动位置
    // Bubble.List 使用 column-reverse 布局，scrollTop 为负值表示已滚动到上方
    useEffect(() => {
        const el = scrollContainerRef.current
        if (!el) return

        // Bubble.List 的实际滚动容器是 .ant-bubble-list-scroll-box
        const scrollBox = el.querySelector('.ant-bubble-list-scroll-box') as HTMLElement | null
        if (!scrollBox) return

        const handleScroll = () => {
            const threshold = 20
            // column-reverse: scrollTop=0 表示在底部，负值表示滚到了上方
            setShowScrollBottom(scrollBox.scrollTop < -threshold)
        }

        scrollBox.addEventListener('scroll', handleScroll, { passive: true })
        return () => scrollBox.removeEventListener('scroll', handleScroll)
    }, [parsedMessages.length])

    // 跳到底部（column-reverse: scrollTop=0 即底部）
    const handleScrollToBottom = useCallback(() => {
        const el = scrollContainerRef.current
        if (!el) return
        const scrollBox = el.querySelector('.ant-bubble-list-scroll-box') as HTMLElement | null
        if (scrollBox) {
            scrollBox.scrollTo({ top: 0, behavior: 'smooth' })
        }
    }, [])

    // 将 ParsedMessage 转换为 Bubble.List items
    // Bubble.List 内置支持 role: 'system'，自动用 Bubble.System 渲染
    const bubbleItems = useMemo(() => {
        const items: Array<{
            key: string
            role: 'assistant' | 'user' | 'system'
            content: React.ReactNode
            typing?: boolean
            variant?: 'borderless'
            _apiErrorCode?: string | null
        }> = []

        for (const msg of parsedMessages) {
            for (let i = 0; i < msg.content.length; i++) {
                const block = msg.content[i]
                const blockKey = `${msg.id}-${i}`
                const isLastAssistantBlock = msg.role === 'assistant' && i === msg.content.length - 1
                const isThinking = isLastAssistantBlock && !!session?.thinking
                const content = renderContentBlock(block, token, isThinking, t)

                if (content === null) continue

                if (msg.role === 'system') {
                    const isApiError = block.type === 'event' && block.event.type === 'api-error'
                    // 用 error code 判断同一次重试链，合并为只展示最后一条
                    if (isApiError && items.length > 0 && items[items.length - 1]._apiErrorCode) {
                        const prevCode = items[items.length - 1]._apiErrorCode
                        const curCode = getApiErrorCode(block.event.error)
                        if (prevCode === curCode) {
                            items[items.length - 1] = {
                                key: blockKey, role: 'system', content, variant: 'borderless',
                                _apiErrorCode: curCode,
                            }
                            continue
                        }
                    }
                    items.push({
                        key: blockKey, role: 'system', content, variant: 'borderless',
                        _apiErrorCode: isApiError ? getApiErrorCode(block.event.error) : undefined,
                    })
                    continue
                }

                items.push({
                    key: blockKey,
                    role: msg.role,
                    content,
                    typing: msg.role === 'assistant' &&
                        block.type === 'text' &&
                        i === msg.content.length - 1 &&
                        session?.thinking,
                })
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
            <div ref={scrollContainerRef} style={{ flex: 1, overflow: 'auto', padding: '16px 8px', fontFamily: 'var(--font-chat)', position: 'relative' }}>
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
                            bottom: 8,
                            transform: 'translateX(-50%)',
                            zIndex: 10,
                            boxShadow: token.boxShadowSecondary,
                            minWidth: 36,
                            minHeight: 36,
                        }}
                    />
                )}
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
function renderContentBlock(block: ParsedContentBlock, token: ReturnType<typeof useToken>['token'], isThinking: boolean, t: (key: string, params?: Record<string, unknown>) => string): React.ReactNode {
    switch (block.type) {
        case 'text':
            return (
                <div style={{ maxWidth: '100%' }}>
                    <XMarkdown content={block.text || ''} />
                </div>
            )
        case 'reasoning':
            return <ReasoningBlock text={block.text} thinking={isThinking} />
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
                    padding: '4px 0',
                    fontSize: 11,
                    color: block.event.type === 'api-error' ? 'rgba(239, 68, 68, 0.45)' : token.colorTextQuaternary,
                    textAlign: 'center',
                }}>
                    {formatEvent(block.event, t)}
                </div>
            )
        default:
            return null
    }
}

// 格式化事件
function formatEvent(event: { type: string; [key: string]: unknown }, t: (key: string, params?: Record<string, unknown>) => string): React.ReactNode {
    switch (event.type) {
        case 'api-error': {
            const detail = extractApiErrorDetail(event.error)
            const retryAttempt = Number(event.retryAttempt) || 0
            const maxRetries = Number(event.maxRetries) || 0
            return (
                <div>
                    <div>{t('chat.apiError')}{retryAttempt > 0 ? ` (${t('chat.retry')} ${retryAttempt}/${maxRetries})` : ''}</div>
                    {detail && <div style={{ marginTop: 2 }}>{detail}</div>}
                </div>
            )
        }
        case 'turn-duration': {
            const ms = Number(event.durationMs) || 0
            if (ms >= 60000) {
                const min = Math.floor(ms / 60000)
                const sec = Math.floor((ms % 60000) / 1000)
                return t('chat.durationValue', { value: `${min}m ${sec}s` })
            }
            if (ms >= 1000) {
                return t('chat.durationValue', { value: `${(ms / 1000).toFixed(1)}s` })
            }
            return t('chat.durationValue', { value: `${ms}ms` })
        }
        case 'switch': {
            const mode = String(event.mode || '')
            return t('chat.switchMode', { mode })
        }
        default:
            return `${event.type}`
    }
}

// 思考过程渲染
// thinking=true: 正在思考，默认展开，标题"思考中..."
// thinking=false: 思考完成，默认收起，标题"思考完成"
function ReasoningBlock({ text, thinking }: { text: string; thinking: boolean }) {
    const { t } = useTranslation()
    const [expanded, setExpanded] = useState(thinking)
    return (
        <Think
            title={thinking ? t('chat.thinking') : t('chat.thought')}
            loading={thinking}
            expanded={expanded}
            onExpand={setExpanded}
        >
            <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                {text}
            </div>
        </Think>
    )
}

// 从 error 对象中提取错误详情用于展示
// error 结构: { error: { error: { code, message } } }
function extractApiErrorDetail(error: unknown): string | null {
    if (!error || typeof error !== 'object') return null
    const err = error as Record<string, unknown>
    if (err.error && typeof err.error === 'object') {
        const inner = err.error as Record<string, unknown>
        if (inner.error && typeof inner.error === 'object') {
            const deepest = inner.error as Record<string, unknown>
            const code = typeof deepest.code === 'string' ? deepest.code : ''
            const message = typeof deepest.message === 'string' ? deepest.message : ''
            if (code || message) return `${code ? `[${code}] ` : ''}${message}`
        }
    }
    return null
}

// 从 error 对象中提取 error code，用于去重判断
// error 结构: { error: { error: { code, message } } } 或 { status }
function getApiErrorCode(error: unknown): string | null {
    if (!error || typeof error !== 'object') return null
    const err = error as Record<string, unknown>
    // 嵌套 error.error.code
    if (err.error && typeof err.error === 'object') {
        const inner = err.error as Record<string, unknown>
        if (inner.error && typeof inner.error === 'object') {
            const deepest = inner.error as Record<string, unknown>
            if (typeof deepest.code === 'string') return deepest.code
        }
    }
    // 退回到 status code
    if (typeof err.status === 'number') return String(err.status)
    return null
}
