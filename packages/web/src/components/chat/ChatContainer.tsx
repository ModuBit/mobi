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

import { useRef, useEffect, useMemo, useState, useCallback, memo } from 'react'
import { Bubble, Think } from '@ant-design/x'
import { Spin, Empty, Button, theme as antTheme } from 'antd'
import { DownOutlined, CodeOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { useMessages } from '@/core/data/hooks/queries/useMessages'
import { useSession } from '@/core/data/hooks/queries/useSession'
import { useSendMessage } from '@/core/data/hooks/mutations/useSendMessage'
import { useSessionActions } from '@/core/data/hooks/mutations/useSessionActions'
import { reduceChatBlocks, normalizeDecryptedMessage } from '@/domain/chat'
import { PermissionRequest } from './PermissionRequest'
import { ToolDetailDrawer } from '@/components/ToolCard/ToolDetailDrawer'
import { getToolIcon, StatusStateIcon } from '@/components/ToolCard/toolIcons'
import { getToolPresentation } from '@/components/ToolCard/knownTools'
import { getToolResultViewComponent } from '@/components/ToolCard/views/_results'
import { ChatComposer } from '@/components/composer/ChatComposer'
import { OverflowContainer } from '@/components/ui/OverflowContainer'
import { CliOutputDetailDrawer } from './CliOutputDetailDrawer'
import { XMarkdown } from '@ant-design/x-markdown'

import type { ChatBlock, AgentEventBlock as AgentEventBlockType } from '@/domain/chat'
import type { SessionMetadataSummary } from '@/core/data/api/types'

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
    /** 传递给 ChatComposer 的额外按钮 */
    extraComposerButtons?: React.ReactNode
}

export function ChatContainer({ sessionId, extraComposerButtons }: ChatContainerProps) {
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

    // 使用 reduceChatBlocks 处理消息（包含 CLI 输出合并）
    const { blocks: chatBlocks } = useMemo(() => {
        // 先标准化消息，然后归约为聊天块
        const normalized = messages
            .map(normalizeDecryptedMessage)
            .filter((m): m is Exclude<typeof m, null> => m !== null)
        return reduceChatBlocks(normalized, session?.agentState)
    }, [messages, session?.agentState])

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
    }, [chatBlocks.length])

    // 跳到底部（column-reverse: scrollTop=0 即底部）
    const handleScrollToBottom = useCallback(() => {
        const el = scrollContainerRef.current
        if (!el) return
        const scrollBox = el.querySelector('.ant-bubble-list-scroll-box') as HTMLElement | null
        if (scrollBox) {
            scrollBox.scrollTo({ top: 0, behavior: 'smooth' })
        }
    }, [])

    // 将 ChatBlock 转换为 Bubble.List items
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

            const content = renderChatBlock(block, { metadata, isThinking: !!session?.thinking })
            if (content === null) continue

            // 确定角色
            let role: 'assistant' | 'user' | 'system' = 'user'
            if (block.kind === 'agent-text' || block.kind === 'agent-reasoning' || block.kind === 'tool-call') {
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
                block.id === lastAssistantBlockKey &&
                !!session?.thinking

            items.push({
                key: block.id,
                role,
                content,
                typing: isTyping,
                variant: (role === 'system' || role === 'assistant') ? 'borderless' : undefined,
                footer: block.kind === 'user-text' ? (
                    <span style={{ fontSize: 11, opacity: 0.6 }}>{formatMessageTime(block.createdAt)}</span>
                ) : undefined,
                footerPlacement: 'outer-end',
            })
        }

        return items
    }, [chatBlocks, session?.thinking, token, t, metadata])

    // 自动滚动到底部
    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [chatBlocks.length])

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
                {chatBlocks.length === 0 ? (
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
                allowSendWhenInactive={false}
                thinking={session?.thinking ?? false}
                agentState={session?.agentState}
                contextSize={undefined} // TODO: 从消息中计算上下文大小
                agentFlavor={agentFlavor}
                mode={session?.mode}
                workingDir={session?.metadata?.path}
                onPermissionModeChange={handlePermissionModeChange}
                onSend={handleSend}
                onAbort={handleAbort}
                onActivate={() => sessionActions.resumeSession()}
                activatePending={sessionActions.isResumePending}
                onSwitchToRemote={() => sessionActions.switchSession()}
                switchPending={sessionActions.isSwitchPending}
                extraLeftButtons={extraComposerButtons}
            />
        </div>
    )
}

const BASH_TAGS_REGEX = /<bash-(?:input|stdout|stderr)>/i

function hasBashTags(text: string): boolean {
    return BASH_TAGS_REGEX.test(text)
}

// 解析 CLI 输出文本，提取命令和输出
function parseCliOutputText(text: string): { command: string | null, stdout: string | null, stderr: string | null } {
    // bash-input / bash-stdout / bash-stderr 标签
    const bashInputMatch = text.match(/<bash-input>([\s\S]*?)<\/bash-input>/i)
    const bashStdoutMatch = text.match(/<bash-stdout>([\s\S]*?)<\/bash-stdout>/i)
    const bashStderrMatch = text.match(/<bash-stderr>([\s\S]*?)<\/bash-stderr>/i)

    if (bashInputMatch) {
        return {
            command: `$ ${bashInputMatch[1].trim()}`,
            stdout: bashStdoutMatch ? bashStdoutMatch[1].trim() : null,
            stderr: bashStderrMatch ? bashStderrMatch[1].trim() : null,
        }
    }

    // 兼容原有 command-name / local-command-stdout 标签
    const commandMatch = text.match(/<command-name>([\s\S]*?)<\/command-name>/i)
    const stdoutMatch = text.match(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/i)

    const command = commandMatch ? commandMatch[1].replace(/&#x[0-9A-Fa-f]+;/g, (_, hex) =>
        String.fromCharCode(parseInt(hex, 16))
    ).trim() : null

    const stdout = stdoutMatch ? stdoutMatch[1].replace(/&#x[0-9A-Fa-f]+;/g, (_, hex) =>
        String.fromCharCode(parseInt(hex, 16))
    ).replace(/\x1B\[[0-9;]*m/g, '').trim() : null

    return { command, stdout, stderr: null }
}

// 渲染文本块（user-text / agent-text 共用）
const TextBlock = memo(function TextBlock({ text, isSynthetic }: { text: string; isSynthetic?: boolean }) {
    if (isSynthetic) {
        return <span style={{ fontSize: 12, opacity: 0.5 }}>{text}</span>
    }
    return (
        <div style={{ maxWidth: '100%' }}>
            <XMarkdown content={text || ''} />
        </div>
    )
})

// CLI 输出渲染（使用 Think 组件，与 ToolCall 渲染风格统一）
const CliOutputBlock = memo(function CliOutputBlock({ text }: { text: string }) {
    const { token } = useToken()
    const { t } = useTranslation()
    const [expanded, setExpanded] = useState(true)
    const [drawerOpen, setDrawerOpen] = useState(false)
    const { command, stdout, stderr } = parseCliOutputText(text)
    const hasOutput = !!stdout || !!stderr

    return (
        <>
            <Think
                icon={<CodeOutlined />}
                title={
                    <span style={{ fontWeight: 500, fontSize: 13, fontFamily: 'var(--font-mono)' }}>
                        {command}
                    </span>
                }
                expanded={expanded}
                onExpand={setExpanded}
            >
                {hasOutput ? (
                    <div style={{ position: 'relative', marginTop: 4 }}>
                        <OverflowContainer
                            maxHeight={200}
                            className="hide-scrollbar"
                            onClickExpand={() => setDrawerOpen(true)}
                            style={{
                                fontFamily: 'var(--font-mono)',
                                fontSize: 12,
                                lineHeight: 1.6,
                                whiteSpace: 'pre',
                                overflowX: 'hidden',
                            }}
                        >
                            {stdout && <span style={{ color: token.colorTextSecondary }}>{stdout}</span>}
                            {stderr && (
                                <span style={{ color: token.colorError }}>
                                    {stdout ? '\n' : ''}
                                    {stderr}
                                </span>
                            )}
                        </OverflowContainer>
                    </div>
                ) : (
                    <div style={{ marginTop: 4, fontSize: 12, color: token.colorTextQuaternary, fontStyle: 'italic' }}>
                        {t('chat.tool.noOutput')}
                    </div>
                )}
            </Think>
            <CliOutputDetailDrawer
                title={command}
                stdout={stdout}
                stderr={stderr}
                open={drawerOpen}
                onClose={() => setDrawerOpen(false)}
            />
        </>
    )
})

// Agent 事件渲染
const AgentEventBlock = memo(function AgentEventBlock({ block }: { block: AgentEventBlockType }) {
    const { token } = useToken()
    const { t } = useTranslation()

    if (block.event.type === 'message') {
        return (
            <div style={{
                padding: '4px 0',
                fontSize: 11,
                color: token.colorTextQuaternary,
            }}>
                {String(block.event.message ?? '')}
            </div>
        )
    }

    const content = formatEvent(block.event, t)
    if (content === null) return null

    const d = block.display
    const alignClass = d?.align ? `event-align-${d.align}` : undefined
    const colorValue = d?.color === 'error' || d?.color === 'warning'
        ? 'rgba(239, 68, 68, 0.45)'
        : token.colorTextQuaternary
    return (
        <div
            className={alignClass}
            style={{
                padding: d?.padding === false ? 0 : '4px 0',
                fontSize: 11,
                color: colorValue,
            }}
        >
            {content}
        </div>
    )
})

// 渲染 ChatBlock
function renderChatBlock(block: ChatBlock, ctx: {
    metadata: SessionMetadataSummary | null
    isThinking: boolean
}): React.ReactNode {
    switch (block.kind) {
        case 'user-text':
            return <TextBlock text={block.text} isSynthetic={block.isSynthetic} />
        case 'agent-text':
            return <TextBlock text={block.text} isSynthetic={block.isSynthetic} />
        case 'agent-reasoning':
            return <ReasoningBlock text={block.text} thinking={ctx.isThinking} />
        case 'cli-output':
            return <CliOutputBlock text={block.text} />
        case 'tool-call':
            return <ToolCallRenderer block={block} metadata={ctx.metadata} />
        case 'agent-event':
            return <AgentEventBlock block={block} />
        default:
            return null
    }
}


// 格式化事件
function formatEvent(event: { type: string; [key: string]: unknown }, t: (key: string, params?: Record<string, unknown>) => string): React.ReactNode {
    switch (event.type) {
        case 'api-retry': {
            const attempt = Number(event.attempt) || 0
            const maxRetries = Number(event.maxRetries) || 0
            const delaySec = Math.ceil((Number(event.retryDelayMs) || 0) / 1000)
            const errorStatus = Number(event.errorStatus) || 0
            const errorLabel = errorStatus === 429 ? t('chat.apiRateLimit') : t('chat.apiError')
            return (
                <div>
                    <div>{errorLabel}{attempt > 0 ? ` (${t('chat.retry')} ${attempt}/${maxRetries})` : ''}</div>
                    {delaySec > 0 && <div style={{ marginTop: 2 }}>{t('chat.retryDelay', { seconds: delaySec })}</div>}
                </div>
            )
        }
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
        case 'title-changed': {
            // 不显示 title-changed 事件
            return null
        }
        case 'execution-error': {
            const subtype = String(event.subtype ?? 'unknown')
            const errors = Array.isArray(event.errors) ? event.errors.join(', ') : ''
            return (
                <div>
                    <div>{t('chat.executionError')}</div>
                    {errors && <div style={{ marginTop: 2 }}>{errors}</div>}
                </div>
            )
        }
        default:
            return `${event.type}`
    }
}

// 思考过程渲染
// thinking=true: 正在思考，默认展开，标题"思考中..."
// thinking=false: 思考完成，默认收起，标题"思考完成"
const ReasoningBlock = memo(function ReasoningBlock({ text, thinking }: { text: string; thinking: boolean }) {
    const { t } = useTranslation()
    const [expanded, setExpanded] = useState(thinking)
    return (
        <Think
            title={thinking ? t('chat.thinking') : t('chat.thought')}
            blink={thinking}
            expanded={expanded}
            onExpand={setExpanded}
        >
            <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                {text}
            </div>
        </Think>
    )
})

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

// 渲染 ToolCallBlock（来自 reduceChatBlocks）
function ToolCallRenderer({ block, metadata }: {
    block: Extract<ChatBlock, { kind: 'tool-call' }>
    metadata: SessionMetadataSummary | null
}) {
    const { token } = useToken()
    const { t } = useTranslation()
    const [expanded, setExpanded] = useState(true)
    const [drawerOpen, setDrawerOpen] = useState(false)

    const tool = block.tool
    const isLoading = tool.state === 'running'
    const toolPresentation = getToolPresentation({
        toolName: tool.name,
        input: tool.input,
        result: tool.result,
        childrenCount: block.children?.length ?? 0,
        description: tool.description ?? null,
        metadata
    })

    return (
        <>
            <Think
                className="tool-call-think"
                icon={getToolIcon(tool.name)}
                title={
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, overflow: 'hidden' }}>
                        <span style={{ fontWeight: 500, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: '1 1 0', minWidth: 0 }}>
                            {toolPresentation.title}
                        </span>
                        {tool.description && (
                            <span style={{ fontSize: 11, color: token.colorTextTertiary, fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 1, minWidth: 0, maxWidth: '40%' }}>
                                {tool.description.length > 60 ? `${tool.description.slice(0, 60)}...` : tool.description}
                            </span>
                        )}
                        <span style={{ color: tool.state === 'completed' ? token.colorSuccess : tool.state === 'error' ? token.colorError : token.colorTextSecondary, display: 'inline-flex', alignItems: 'center', marginLeft: 'auto', flexShrink: 0 }}>
                            <StatusStateIcon state={tool.state} />
                        </span>
                    </div>
                }
                blink={isLoading}
                expanded={expanded}
                onExpand={setExpanded}
            >
                <ToolCallPreviewContent
                    toolCallBlock={block}
                    metadata={metadata}
                    onViewDetail={() => setDrawerOpen(true)}
                />
            </Think>
            <ToolDetailDrawer
                block={block}
                metadata={metadata}
                open={drawerOpen}
                onClose={() => setDrawerOpen(false)}
            />
        </>
    )
}

// 工具预览内容（在 Think 展开区域内渲染）
function ToolCallPreviewContent({
    toolCallBlock,
    metadata,
    onViewDetail
}: {
    toolCallBlock: Extract<ChatBlock, { kind: 'tool-call' }>
    metadata: SessionMetadataSummary | null
    onViewDetail: () => void
}) {
    const tool = toolCallBlock.tool
    const ResultView = useMemo(() => getToolResultViewComponent(tool.name), [tool.name])

    // 转换为 ToolCard/types.ToolCallBlock 格式
    const adaptedBlock = useMemo(() => {
        type ChatToolPermission = NonNullable<typeof tool.permission>
        const convertPerm = (perm: ChatToolPermission) => ({
            id: perm.id,
            status: perm.status,
            reason: perm.reason,
            decision: perm.decision === 'denied' ? 'abort' as const : perm.decision === 'approved_for_session' ? 'approved_for_session' as const : perm.decision === 'approved' ? 'approved' as const : undefined,
            mode: perm.mode === 'acceptEdits' ? ('acceptEdits' as const) : undefined,
            allowedTools: perm.allowedTools,
            answers: perm.answers,
        })
        return {
            id: toolCallBlock.id,
            kind: 'tool-call' as const,
            tool: {
                name: tool.name,
                input: tool.input,
                result: tool.result ?? undefined,
                state: tool.state,
                description: tool.description,
                startedAt: tool.startedAt,
                createdAt: tool.createdAt,
                permission: tool.permission ? convertPerm(tool.permission) : null,
            },
            children: toolCallBlock.children
                .filter((b): b is Extract<ChatBlock, { kind: 'tool-call' }> => b.kind === 'tool-call')
                .map((child) => ({
                    id: child.id,
                    kind: 'tool-call' as const,
                    tool: {
                        name: child.tool.name,
                        input: child.tool.input,
                        result: child.tool.result ?? undefined,
                        state: child.tool.state,
                        description: child.tool.description,
                        startedAt: child.tool.startedAt,
                        createdAt: child.tool.createdAt,
                        permission: child.tool.permission ? convertPerm(child.tool.permission) : null,
                    },
                    children: [],
                })),
        }
    }, [toolCallBlock, tool])

    const showPreview = tool.state !== 'running' && tool.result !== undefined

    if (!showPreview) return null

    return (
        <div style={{ marginTop: 4, paddingLeft: 12, paddingRight: 12 }}>
            <OverflowContainer maxHeight={100} onClickExpand={onViewDetail}>
                <ResultView block={adaptedBlock} metadata={metadata} />
            </OverflowContainer>
        </div>
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
