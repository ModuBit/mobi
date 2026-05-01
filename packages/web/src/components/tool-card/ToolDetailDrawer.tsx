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

/**
 * 抽屉详情组件
 * 点击内联预览后弹出，展示工具调用的完整输入和输出信息
 */

import { useMemo, useRef, useState, useCallback, useEffect, memo, type CSSProperties } from 'react'
import { theme as antTheme, Typography, Button } from 'antd'
import { DownOutlined } from '@ant-design/icons'
import { Bubble } from '@ant-design/x'
import { safeStringify } from '@mobi/shared'
import { useTranslation } from 'react-i18next'
import type { SessionMetadataSummary } from '@/core/data/api/types'
import type { ToolCallBlock } from '@/domain/tool/types'
import type { ChatBlock, NormalizedMessage } from '@/domain/chat'
import { normalizeDecryptedMessage, reduceChatBlocks } from '@/domain/chat'
import { getToolPresentation, isAgentTool, getAgentTitle } from './knownTools'
import { getToolIcon, ICON_STYLE_LG, StatusStateIcon } from './toolIcons'
import { getToolFullViewComponent, getToolViewComponent } from './views/_all'
import { getToolResultViewComponent } from './views/_results'
import { truncate } from '@/core/lib/toolInputUtils'
import { isObject } from '@mobi/shared'
import { Markdown } from '@/components/ui/Markdown'
import { ContentDrawer, DRAWER_WIDTH_PRESETS, type DrawerWidthConfig } from '@/components/ui/ContentDrawer'
import { FilePathText } from '@/components/ui/FilePathText'
import { renderChatBlock, type ChatBlockContext } from '@/components/chat/blocks'
import { BUBBLE_ROLES } from '@/components/chat/ChatContainer'
import { useSidechainMessages } from '@/core/data/hooks/queries/useSidechainMessages'

const { Text } = Typography
const { useToken } = antTheme

const ASSISTANT_BLOCK_KINDS = new Set(['agent-text', 'agent-reasoning', 'tool-call', 'compact-summary'])

/**
 * 抽屉详情组件属性
 */
type ToolDetailDrawerProps = {
    block: Extract<ChatBlock, { kind: 'tool-call' }>
    metadata: SessionMetadataSummary | null
    open: boolean
    onClose: () => void
    sessionId?: string
}

/**
 * 将 ChatBlock.ToolCallBlock 转换为 ToolCard/types.ToolCallBlock，以适配视图组件接口
 */
function chatBlockToToolCardBlock(block: Extract<ChatBlock, { kind: 'tool-call' }>): ToolCallBlock {
    const convertPermission = (perm: NonNullable<typeof block.tool.permission>): ToolCallBlock['tool']['permission'] => {
        return {
            id: perm.id,
            status: perm.status,
            reason: perm.reason,
            decision: perm.decision === 'denied' ? ('abort' as const) : perm.decision === 'approved_for_session' ? ('approved_for_session' as const) : perm.decision === 'approved' ? ('approved' as const) : undefined,
            mode: perm.mode === 'acceptEdits' ? ('acceptEdits' as const) : undefined,
            allowedTools: perm.allowedTools,
            answers: perm.answers,
        }
    }

    return {
        id: block.id,
        kind: 'tool-call',
        tool: {
            name: block.tool.name,
            input: block.tool.input,
            result: block.tool.result ?? undefined,
            state: block.tool.state,
            description: block.tool.description,
            startedAt: block.tool.startedAt,
            createdAt: block.tool.createdAt,
            permission: block.tool.permission ? convertPermission(block.tool.permission) : null,
        },
        children: block.children
            .filter((b): b is Extract<ChatBlock, { kind: 'tool-call' }> => b.kind === 'tool-call')
            .map(chatBlockToToolCardBlock),
    }
}

/**
 * 获取状态文字描述
 */
function getStatusText(state: 'pending' | 'running' | 'completed' | 'error', t: (key: string) => string): string {
    switch (state) {
        case 'completed': return t('chat.tool.statusDone')
        case 'error': return t('chat.tool.statusError')
        case 'running': return t('chat.tool.statusRunning')
        case 'pending': return ''
    }
}

/** Agent 工具的 Drawer 内容：BubbleList 渲染 sidechain 对话 */
function AgentDrawerContent({ block, metadata, sessionId }: {
    block: Extract<ChatBlock, { kind: 'tool-call' }>
    metadata: SessionMetadataSummary | null
    sessionId?: string
}) {
    const { token } = antTheme.useToken()
    const scrollRef = useRef<HTMLDivElement>(null)
    const [showScrollBottom, setShowScrollBottom] = useState(false)

    const tool = block.tool
    const hasChildren = block.children.length > 0

    // 实时会话 children 已有数据，历史会话从 API 补载
    const { data: sidechainMessages = [] } = useSidechainMessages(
        hasChildren ? null : (sessionId ?? null),
        hasChildren ? null : block.id,
    )

    const childrenBlocks = useMemo(() => {
        if (hasChildren) return block.children
        if (sidechainMessages.length === 0) return []

        const normalized = sidechainMessages
            .map((msg) => normalizeDecryptedMessage(msg))
            .filter((m): m is NormalizedMessage => m !== null)
        const { blocks } = reduceChatBlocks(normalized, null)
        return blocks
    }, [hasChildren, block.children, sidechainMessages])

    const bubbleItems = useMemo(() => {
        const ctx: ChatBlockContext = {
            metadata,
            isThinking: false,
            disableDrawer: true,
        }
        const items: Array<{
            key: string
            role: 'assistant' | 'user' | 'system' | 'divider'
            content: React.ReactNode
            variant?: 'borderless'
        }> = []

        for (const child of childrenBlocks) {
            const content = renderChatBlock(child, ctx)
            if (content === null) continue

            let role: 'assistant' | 'user' | 'system' = 'user'
            if (ASSISTANT_BLOCK_KINDS.has(child.kind)) {
                role = 'assistant'
            } else if (child.kind === 'agent-event') {
                role = 'system'
            }

            items.push({
                key: child.id,
                role,
                content,
                variant: (role === 'system' || role === 'assistant') ? 'borderless' : undefined,
            })
        }

        // Divider: Result
        items.push({
            key: '__result-divider__',
            role: 'divider',
            content: 'Result',
        })

        // Result bubble
        if (tool.result !== undefined && tool.result !== null) {
            const resultText = typeof tool.result === 'string'
                ? tool.result
                : safeStringify(tool.result)
            items.push({
                key: '__result__',
                role: 'assistant',
                content: <Markdown content={resultText} />,
                variant: 'borderless',
            })
        }

        return items
    }, [childrenBlocks, tool.result, metadata])

    // 滚动到底部
    useEffect(() => {
        const scrollBox = scrollRef.current
        if (!scrollBox) return
        scrollBox.scrollTo({ top: 0, behavior: 'smooth' })
    }, [childrenBlocks.length])

    useEffect(() => {
        const scrollBox = scrollRef.current
        if (!scrollBox) return
        const handleScroll = () => {
            setShowScrollBottom(scrollBox.scrollTop < -20)
        }
        scrollBox.addEventListener('scroll', handleScroll, { passive: true })
        return () => scrollBox.removeEventListener('scroll', handleScroll)
    }, [childrenBlocks.length])

    const handleScrollToBottom = useCallback(() => {
        scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
    }, [])

    return (
        <div style={{ position: 'relative', height: '100%' }}>
            <div ref={scrollRef} style={{ height: '100%', overflow: 'auto' }}>
                <Bubble.List
                    items={bubbleItems}
                    role={BUBBLE_ROLES}
                    style={{ height: '100%' }}
                />
            </div>
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
                        bottom: 16,
                        transform: 'translateX(-50%)',
                        zIndex: 10,
                        boxShadow: token.boxShadowSecondary,
                        minWidth: 36,
                        minHeight: 36,
                    }}
                />
            )}
        </div>
    )
}

/**
 * 抽屉详情组件
 * 展示工具调用的完整输入和输出信息，桌面端从右侧滑出，移动端从底部弹出
 */
function ToolDetailDrawerInner({ block, metadata, open, onClose, sessionId }: ToolDetailDrawerProps) {
    const { t } = useTranslation()
    const { token } = useToken()

    const tool = block.tool

    // 缓存展示信息
    const presentation = useMemo(() => getToolPresentation({
        toolName: tool.name,
        input: tool.input,
        result: tool.result,
        childrenCount: block.children.length,
        description: tool.description,
        metadata,
    }), [tool.name, tool.input, tool.result, block.children.length, tool.description, metadata])

    // 缓存视图组件
    const FullView = useMemo(() => getToolFullViewComponent(tool.name), [tool.name])
    const CompactView = useMemo(() => getToolViewComponent(tool.name), [tool.name])
    const ResultView = useMemo(() => getToolResultViewComponent(tool.name), [tool.name])

    // 将 ChatBlock.ToolCallBlock 转为 ToolCard/types.ToolCallBlock 以适配视图接口
    const adaptedBlock = useMemo(() => chatBlockToToolCardBlock(block), [block])

    // 副标题截断到 60 字
    const truncatedSubtitle = presentation.subtitle
        ? truncate(presentation.subtitle, 60)
        : null

    // 状态文字
    const statusText = getStatusText(tool.state, t)

    // 标签样式
    const labelStyle: CSSProperties = {
        marginBottom: 4,
        fontSize: 11,
        fontWeight: 500,
        color: token.colorTextSecondary,
    }

    // 分隔线样式
    const dividerStyle: CSSProperties = {
        borderBottom: `1px solid ${token.colorBorderSecondary}`,
        margin: '12px 0',
    }

    // 区域容器样式
    const sectionStyle: CSSProperties = {
        padding: '12px 16px',
    }

    // 标题栏
    const agentTitleOverride = isAgentTool(tool.name) ? getAgentTitle(tool.input) : null
    const drawerTitle = agentTitleOverride ?? presentation.title
    const titleContent = (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', color: token.colorTextSecondary }}>
                {getToolIcon(tool.name, { style: ICON_STYLE_LG, id: block.id, state: tool.state })}
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
                {presentation.isFilePath ? (
                    <FilePathText path={presentation.title} strong style={{ fontSize: 14 }} />
                ) : (
                    <Text strong style={{ fontSize: 14, wordBreak: 'break-word' }}>
                        {drawerTitle}
                    </Text>
                )}
                {truncatedSubtitle ? (
                    <div>
                        <Text type="secondary" style={{ fontSize: 12, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {truncatedSubtitle}
                        </Text>
                    </div>
                ) : null}
            </div>
        </div>
    )

    // 是否有专用视图组件（Edit、Bash 等有专门的 diff/terminal 视图）
    const hasSpecialView = !!(FullView || CompactView)

    // Agent 工具使用 wide 模式，其他按 presentation 配置
    const drawerWidth: DrawerWidthConfig = isAgentTool(tool.name) || presentation.wideDrawer
        ? DRAWER_WIDTH_PRESETS.wide
        : DRAWER_WIDTH_PRESETS.narrow

    return (
        <ContentDrawer
            open={open}
            onClose={onClose}
            title={titleContent}
            widthConfig={drawerWidth}
        >
            {/* Agent 工具：BubbleList 渲染 sidechain 对话 */}
            {isAgentTool(tool.name) ? (
                <AgentDrawerContent block={block} metadata={metadata} sessionId={sessionId} />
            ) : hasSpecialView ? (
                <div style={sectionStyle}>
                    {FullView ? (
                        <FullView block={adaptedBlock} metadata={metadata} />
                    ) : CompactView ? (
                        <CompactView block={adaptedBlock} metadata={metadata} />
                    ) : null}
                </div>
            ) : (
                <>
                    {/* 输入区 */}
                    <div style={sectionStyle}>
                        <div style={labelStyle}>{t('chat.tool.input')}</div>
                        <pre style={{
                            background: token.colorBgContainer,
                            padding: 8,
                            borderRadius: 4,
                            fontSize: 12,
                            overflowX: 'auto',
                            margin: '4px 0',
                            border: `1px solid ${token.colorBorder}`,
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                        }}>
                            {safeStringify(tool.input)}
                        </pre>
                    </div>

                    {/* 分隔线 */}
                    <div style={{ ...dividerStyle, marginLeft: 16, marginRight: 16 }} />

                    {/* 输出区 */}
                    <div style={sectionStyle}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                            <div style={labelStyle}>{t('chat.tool.output')}</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                <StatusStateIcon state={tool.state} style={{ fontSize: 12 }} />
                                {statusText ? (
                                    <Text type="secondary" style={{ fontSize: 11 }}>{statusText}</Text>
                                ) : null}
                            </div>
                        </div>
                        <div style={{ overflowX: 'auto' }}>
                            <ResultView block={adaptedBlock} metadata={metadata} />
                        </div>
                    </div>
                </>
            )}
        </ContentDrawer>
    )
}

export const ToolDetailDrawer = memo(ToolDetailDrawerInner)
