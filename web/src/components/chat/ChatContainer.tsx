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
import { mergeToolResults } from './toolMerger'
import { PermissionRequest } from './PermissionRequest'
import { ToolDetailDrawer } from '@/components/ToolCard/ToolDetailDrawer'
import { getToolIcon, StatusStateIcon } from '@/components/ToolCard/toolIcons'
import { getToolResultViewComponent } from '@/components/ToolCard/views/_results'
import { ChatComposer } from '@/components/composer/ChatComposer'
import { XMarkdown } from '@ant-design/x-markdown'
import { useIsMobile } from '@/hooks/useMediaQuery'

import type { ParsedContentBlock, MergedToolCallBlock } from './messageParser'
import type { ToolCallBlock } from '@/components/ToolCard/types'
import type { SessionMetadataSummary } from '@/api/types'

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

    // 工具渲染所需的元数据
    const metadata = (session?.metadata ?? null) as SessionMetadataSummary | null

    // 解析所有消息并合并 tool result
    const parsedMessages = useMemo(() => {
        return mergeToolResults(parseMessages(messages))
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
            footer?: React.ReactNode
            footerPlacement?: 'inner-start' | 'inner-end' | 'outer-start' | 'outer-end'
        }> = []

        // 用于 api-error 去重的 error code 跟踪（不放入 item 避免 DOM 透传）
        const apiErrorCodeMap = new Map<string, string | null>()

        // 工具渲染所需的上下文
        const toolContext = { metadata }

        for (const msg of parsedMessages) {
            for (let i = 0; i < msg.content.length; i++) {
                const block = msg.content[i]
                const blockKey = `${msg.id}-${i}`
                const isLastAssistantBlock = msg.role === 'assistant' && i === msg.content.length - 1
                const isThinking = isLastAssistantBlock && !!session?.thinking
                const content = renderContentBlock(block, token, isThinking, !!msg.isSynthetic, t, toolContext)

                if (content === null) continue

                if (msg.role === 'system') {
                    const isApiError = block.type === 'event' && block.event.type === 'api-error'
                    // 用 error code 判断同一次重试链，合并为只展示最后一条
                    if (isApiError && items.length > 0) {
                        const lastKey = items[items.length - 1].key
                        const prevCode = apiErrorCodeMap.get(lastKey)
                        if (prevCode) {
                            const curCode = getApiErrorCode(block.event.error)
                            if (prevCode === curCode) {
                                items[items.length - 1] = {
                                    key: blockKey, role: 'system', content, variant: 'borderless',
                                }
                                apiErrorCodeMap.set(blockKey, curCode)
                                continue
                            }
                        }
                    }
                    items.push({
                        key: blockKey, role: 'system', content, variant: 'borderless',
                    })
                    if (isApiError) {
                        apiErrorCodeMap.set(blockKey, getApiErrorCode(block.event.error))
                    }
                    continue
                }

                // 用户消息在最后一个内容块时显示时间戳
                const isUserLastBlock = msg.role === 'user' && i === msg.content.length - 1
                items.push({
                    key: blockKey,
                    role: msg.role,
                    content,
                    typing: msg.role === 'assistant' &&
                        block.type === 'text' &&
                        i === msg.content.length - 1 &&
                        session?.thinking,
                    ...(isUserLastBlock ? {
                        footer: <span style={{ fontSize: 11, opacity: 0.6 }}>{formatMessageTime(msg.createdAt)}</span>,
                        footerPlacement: 'outer-end' as const,
                    } : {}),
                })
            }
        }

        return items
    }, [parsedMessages, session?.thinking, token, t, metadata])

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
            <div ref={scrollContainerRef} style={{ flex: 1, overflow: 'auto', padding: '8px 8px', fontFamily: 'var(--font-chat)', position: 'relative' }}>
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

            {/* 权限请求提示 */}
            <PermissionRequest
                sessionId={sessionId}
                session={session}
            />

            {/* Composer 输入组件 */}
            <ChatComposer
                sessionId={sessionId}
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

// ToolCard 渲染上下文
type ToolRenderContext = {
    metadata: SessionMetadataSummary | null
}

// 渲染内容块
// isSynthetic: 非用户主动输入的消息（如 SDK 自动生成的中断消息），使用柔和样式
function renderContentBlock(
    block: ParsedContentBlock,
    token: ReturnType<typeof useToken>['token'],
    isThinking: boolean,
    isSynthetic: boolean,
    t: (key: string, params?: Record<string, unknown>) => string,
    toolContext: ToolRenderContext,
): React.ReactNode {
    switch (block.type) {
        case 'text':
            if (isSynthetic) {
                return (
                    <span style={{ fontSize: 12, opacity: 0.5 }}>
                        {block.text}
                    </span>
                )
            }
            return (
                <div style={{ maxWidth: '100%' }}>
                    <XMarkdown content={block.text || ''} />
                </div>
            )
        case 'reasoning':
            return <ReasoningBlock text={block.text} thinking={isThinking} />
        case 'merged-tool-call':
            return (
                <MergedToolCallRenderer
                    block={block}
                    toolContext={toolContext}
                />
            )
        // tool-call 和 tool-result 在 merge 后不再出现，保留 fallback
        case 'tool-call':
        case 'tool-result':
            return null
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
        case 'aborted': {
            return t('chat.aborted')
        }
        case 'execution-error': {
            return t('chat.executionError')
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

// 将 MergedToolCallBlock 转换为 ToolCallBlock 以适配视图组件接口
function mergedToToolCallBlock(block: MergedToolCallBlock): ToolCallBlock {
    return {
        id: block.id,
        kind: 'tool-call',
        tool: {
            name: block.name,
            input: block.input,
            result: block.result,
            state: block.state,
            description: block.description,
            startedAt: null,
            createdAt: block.createdAt,
            permission: null,
        },
        children: block.children.map(mergedToToolCallBlock),
    }
}

// 工具预览内容（在 Think 展开区域内渲染）
function ToolPreviewContent({ block, metadata, onViewDetail }: {
    block: MergedToolCallBlock
    metadata: SessionMetadataSummary | null
    onViewDetail: () => void
}) {
    const { token } = useToken()
    const { t } = useTranslation()
    const isMobile = useIsMobile()
    const contentRef = useRef<HTMLDivElement>(null)
    const [isOverflowing, setIsOverflowing] = useState(false)

    const ResultView = useMemo(() => getToolResultViewComponent(block.name), [block.name])
    const adaptedBlock = useMemo(() => mergedToToolCallBlock(block), [block])

    const showPreview = block.state !== 'running' && block.result !== undefined

    // 溢出检测
    useEffect(() => {
        const el = contentRef.current
        if (!el) return
        const observer = new ResizeObserver(() => {
            setIsOverflowing(el.scrollHeight > el.clientHeight)
        })
        observer.observe(el)
        return () => observer.disconnect()
    }, [ResultView, block.result])

    if (!showPreview) return null

    const maxContentHeight = 100

    return (
        <div
            onClick={(e) => { e.stopPropagation(); onViewDetail() }}
            style={{ position: 'relative', marginTop: 4, cursor: 'pointer', paddingLeft: 12, paddingRight: 12, paddingBottom: 24 }}
        >
            <div style={{ maxHeight: maxContentHeight, overflow: 'hidden' }} ref={contentRef}>
                <ResultView block={adaptedBlock} metadata={metadata} />
            </div>
            {/* 渐变遮罩 - 始终显示，暗示内容为预览，承载点击打开 drawer */}
            <div style={{
                position: 'absolute', bottom: 0, left: 0, right: 0, height: 48,
                background: `linear-gradient(transparent, ${token.colorBgContainer} 70%)`,
                display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
                paddingBottom: 4, color: token.colorPrimary, fontSize: 12,
            }}>
                {t('chat.tool.viewDetail')} →
            </div>
        </div>
    )
}

// 合并工具调用的渲染组件
// 使用 Think 组件作为外壳，默认展开显示内联预览，点击标题栏收起
// 点击「查看详情」打开 ToolDetailDrawer 查看完整信息
function MergedToolCallRenderer({ block, toolContext }: {
    block: MergedToolCallBlock
    toolContext: ToolRenderContext
}) {
    const { token } = useToken()
    const [expanded, setExpanded] = useState(true)
    const [drawerOpen, setDrawerOpen] = useState(false)

    const isLoading = block.state === 'running'

    return (
        <>
            <Think
                className="tool-call-think"
                icon={getToolIcon(block.name)}
                title={
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 500, fontSize: 13 }}>{block.name}</span>
                        {block.description && (
                            <span style={{ fontSize: 11, color: token.colorTextTertiary, fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>
                                {block.description.length > 80 ? `${block.description.slice(0, 80)}...` : block.description}
                            </span>
                        )}
                        <span style={{ color: block.state === 'completed' ? token.colorSuccess : block.state === 'error' ? token.colorError : token.colorTextSecondary, display: 'inline-flex', alignItems: 'center', marginLeft: 'auto' }}>
                            <StatusStateIcon state={block.state} />
                        </span>
                    </div>
                }
                loading={isLoading}
                expanded={expanded}
                onExpand={setExpanded}
            >
                <ToolPreviewContent
                    block={block}
                    metadata={toolContext.metadata}
                    onViewDetail={() => setDrawerOpen(true)}
                />
            </Think>
            <ToolDetailDrawer
                block={block}
                metadata={toolContext.metadata}
                open={drawerOpen}
                onClose={() => setDrawerOpen(false)}
            />
        </>
    )
}

// 格式化消息时间：当天 HH:mm，非当天 MM/DD HH:mm，非当年 YYYY/MM/DD HH:mm
function formatMessageTime(createdAt: number): string {
    const date = new Date(createdAt)
    const now = new Date()
    const hours = date.getHours().toString().padStart(2, '0')
    const minutes = date.getMinutes().toString().padStart(2, '0')
    const time = `${hours}:${minutes}`

    const sameYear = date.getFullYear() === now.getFullYear()
    const sameMonth = sameYear && date.getMonth() === now.getMonth()
    const sameDay = sameMonth && date.getDate() === now.getDate()

    if (sameDay) return time
    const monthDay = `${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getDate().toString().padStart(2, '0')}`
    if (sameYear) return `${monthDay} ${time}`
    return `${date.getFullYear()}/${monthDay} ${time}`
}
