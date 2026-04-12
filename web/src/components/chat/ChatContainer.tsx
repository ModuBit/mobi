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
import { Spin, Empty, Button, Modal, theme as antTheme } from 'antd'
import { DownOutlined } from '@ant-design/icons'
import {
    Check, X, Loader, Terminal, FileSearch, Eye, FileEdit, Pencil,
    Globe, Lightbulb, Rocket, Users, MessageSquare, HelpCircle,
    FileText, ListChecks, Blocks, Wrench, Play,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useMessages } from '@/hooks/queries/useMessages'
import { useSession } from '@/hooks/queries/useSession'
import { useSendMessage } from '@/hooks/mutations/useSendMessage'
import { useSessionActions } from '@/hooks/mutations/useSessionActions'
import { parseMessages } from './messageParser'
import { mergeToolResults } from './toolMerger'
import { getToolPresentation } from '@/components/ToolCard/knownTools'
import { PermissionRequest } from './PermissionRequest'
import { ChatComposer } from '@/components/composer/ChatComposer'
import { XMarkdown } from '@ant-design/x-markdown'

import type { ParsedContentBlock, MergedToolCallBlock } from './messageParser'
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
                const content = renderContentBlock(block, token, isThinking, t, toolContext)

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
function renderContentBlock(
    block: ParsedContentBlock,
    token: ReturnType<typeof useToken>['token'],
    isThinking: boolean,
    t: (key: string, params?: Record<string, unknown>) => string,
    toolContext: ToolRenderContext,
): React.ReactNode {
    switch (block.type) {
        case 'text':
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

// Lucide 图标样式
const ICON_STYLE: React.CSSProperties = { width: 14, height: 14 }

// 根据工具名获取 Lucide 图标
function getToolIcon(name: string): React.ReactNode {
    if (name.startsWith('mcp__')) return <Blocks style={ICON_STYLE} />

    const iconMap: Record<string, React.ReactNode> = {
        Task: <Rocket style={ICON_STYLE} />,
        TeamCreate: <Users style={ICON_STYLE} />,
        TeamDelete: <Users style={ICON_STYLE} />,
        SendMessage: <MessageSquare style={ICON_STYLE} />,
        Bash: <Terminal style={ICON_STYLE} />,
        shell_command: <Terminal style={ICON_STYLE} />,
        Read: <Eye style={ICON_STYLE} />,
        Edit: <FileEdit style={ICON_STYLE} />,
        MultiEdit: <FileEdit style={ICON_STYLE} />,
        Write: <Pencil style={ICON_STYLE} />,
        Glob: <FileSearch style={ICON_STYLE} />,
        Grep: <FileSearch style={ICON_STYLE} />,
        LS: <FileSearch style={ICON_STYLE} />,
        WebFetch: <Globe style={ICON_STYLE} />,
        WebSearch: <Globe style={ICON_STYLE} />,
        AskUserQuestion: <HelpCircle style={ICON_STYLE} />,
        ask_user_question: <HelpCircle style={ICON_STYLE} />,
        request_user_input: <HelpCircle style={ICON_STYLE} />,
        ExitPlanMode: <FileText style={ICON_STYLE} />,
        exit_plan_mode: <FileText style={ICON_STYLE} />,
        update_plan: <ListChecks style={ICON_STYLE} />,
        TodoWrite: <ListChecks style={ICON_STYLE} />,
        NotebookRead: <Eye style={ICON_STYLE} />,
        NotebookEdit: <FileEdit style={ICON_STYLE} />,
    }

    return iconMap[name] ?? <Wrench style={ICON_STYLE} />
}

// 状态图标（Lucide）
function StatusStateIcon({ state }: { state: 'pending' | 'running' | 'completed' | 'error' }) {
    const style: React.CSSProperties = { width: 12, height: 12 }
    if (state === 'completed') return <Check style={style} />
    if (state === 'error') return <X style={style} />
    if (state === 'pending') return <Play style={style} />
    return <Loader style={style} className="anticon-spin" />
}

// 合并工具调用的渲染组件
// 使用 Think 组件作为外壳，点击打开弹窗查看详情
function MergedToolCallRenderer({ block, toolContext }: {
    block: MergedToolCallBlock
    toolContext: ToolRenderContext
}) {
    const { t } = useTranslation()
    const { token } = useToken()
    const [modalOpen, setModalOpen] = useState(false)

    const presentation = useMemo(() => getToolPresentation({
        toolName: block.name,
        input: block.input,
        result: block.result,
        childrenCount: block.children.length,
        description: block.description,
        metadata: toolContext.metadata,
    }), [block.name, block.input, block.result, block.children.length, block.description, toolContext.metadata])

    const isLoading = block.state === 'running'
    const subtitle = presentation.subtitle ?? block.description

    const stateColor = block.state === 'completed' ? token.colorSuccess
        : block.state === 'error' ? token.colorError
        : block.state === 'pending' ? token.colorWarning
        : token.colorTextSecondary

    return (
        <>
            <Think
                icon={getToolIcon(block.name)}
                title={
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 500, fontSize: 13 }}>{presentation.title}</span>
                        {subtitle && (
                            <span style={{ fontSize: 11, color: token.colorTextTertiary, fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>
                                {subtitle.length > 80 ? `${subtitle.slice(0, 80)}...` : subtitle}
                            </span>
                        )}
                        <span style={{ color: stateColor, display: 'inline-flex', alignItems: 'center', marginLeft: 'auto' }}>
                            <StatusStateIcon state={block.state} />
                        </span>
                    </div>
                }
                loading={isLoading}
                expanded={false}
                onExpand={() => setModalOpen(true)}
            />

            <Modal
                open={modalOpen}
                onCancel={() => setModalOpen(false)}
                footer={null}
                title={
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {getToolIcon(block.name)}
                        <span>{presentation.title}</span>
                    </div>
                }
                width={640}
            >
                <div style={{ marginTop: 12, display: 'flex', maxHeight: '75vh', flexDirection: 'column', gap: 16, overflow: 'auto' }}>
                    {/* 工具输入 */}
                    {block.input !== undefined && (
                        <div>
                            <div style={{ marginBottom: 4, fontSize: 11, fontWeight: 500, color: token.colorTextSecondary }}>
                                {t('chat.tool.input')}
                            </div>
                            <pre style={{
                                background: token.colorBgContainer,
                                padding: 8,
                                borderRadius: 4,
                                fontSize: 12,
                                overflowX: 'auto',
                                margin: 0,
                                border: `1px solid ${token.colorBorder}`,
                                whiteSpace: 'pre-wrap',
                                wordBreak: 'break-word',
                            }}>
                                {typeof block.input === 'string' ? block.input : JSON.stringify(block.input, null, 2)}
                            </pre>
                        </div>
                    )}
                    {/* 工具输出 */}
                    {block.result !== undefined && (
                        <div>
                            <div style={{ marginBottom: 4, fontSize: 11, fontWeight: 500, color: token.colorTextSecondary }}>
                                {t('chat.tool.output')}
                            </div>
                            <pre style={{
                                background: block.resultIsError ? token.colorErrorBg : token.colorSuccessBg,
                                border: `1px solid ${block.resultIsError ? token.colorErrorBorder : token.colorSuccessBorder}`,
                                padding: 8,
                                borderRadius: 4,
                                fontSize: 12,
                                overflowX: 'auto',
                                margin: 0,
                                whiteSpace: 'pre-wrap',
                                wordBreak: 'break-word',
                                maxHeight: 400,
                                overflowY: 'auto',
                            }}>
                                {typeof block.result === 'string' ? block.result : JSON.stringify(block.result, null, 2)}
                            </pre>
                        </div>
                    )}
                </div>
            </Modal>
        </>
    )
}
