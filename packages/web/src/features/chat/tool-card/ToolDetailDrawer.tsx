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
 * 工具详情容器：点击内联预览后弹出，展示工具调用的完整输入和输出信息。
 * 全端统一 BottomSheet（2026-10-14 从「移动端 sheet / PC 右侧抽屉」的分流收拢——
 * ContentDrawer 随之分流使命消亡而删除）：详情是「临时浮起来看一眼」的心智，
 * 贴底 sheet 与消息流里其它浮层同一套关闭语言（下拉 / 遮罩 / ESC / 手势返回）。
 */

import { useMemo, memo, type CSSProperties } from 'react'
import { theme as antTheme, Typography } from 'antd'
import { safeStringify } from '@mobi/shared'
import { useTranslation } from 'react-i18next'
import type { SessionMetadataSummary } from '@/core/data/api/types'
import type { ToolCallBlock } from '@/domain/tool/types'
import type { ChatBlock } from '@/domain/chat'
import { getToolPresentation, isAgentTool, getAgentTitle } from './knownTools'
import { getToolIcon, ICON_STYLE_LG, StatusIcon, statusIconStyle } from '@/ui/base/display/toolIcons'
import { getToolFullViewComponent, getToolViewComponent } from './views/_all'
import { ToolViewScopeProvider } from './views/toolViewScope'
import { getToolResultViewComponent } from './views/_results'
import { truncate } from '@/core/lib/toolInputUtils'
import { BottomSheet } from '@/ui/shadcn/bottom-sheet/bottom-sheet'
import { AgentDrawerContent } from './AgentDrawerContent'

const { Text } = Typography
const { useToken } = antTheme

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
            suggestions: perm.suggestions,
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
            structuredPatch: block.tool.structuredPatch,
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

/**
 * 工具详情：展示工具调用的完整输入和输出信息
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

    // 标题栏（sheet 头部单行基线：单行省略，副标题同行截断）
    const titleContent = (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <StatusIcon state={tool.state}>
                {getToolIcon(tool.name, ICON_STYLE_LG)}
            </StatusIcon>
            <div style={{ minWidth: 0, flex: 1 }}>
                <Text strong style={{ fontSize: 14, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {isAgentTool(tool.name) ? getAgentTitle(tool.input) : presentation.title}
                </Text>
                {!isAgentTool(tool.name) && truncatedSubtitle && (
                    <Text type="secondary" style={{ fontSize: 12, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {truncatedSubtitle}
                    </Text>
                )}
            </div>
        </div>
    )

    // 是否有专用视图组件（Edit、Bash 等有专门的 diff/terminal 视图）
    const hasSpecialView = !!(FullView || CompactView)

    const renderOutputSection = () => (
        <div style={sectionStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <div style={labelStyle}>{t('chat.tool.output')}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    {statusText ? (
                        <Text type="secondary" style={{ fontSize: 11, ...statusIconStyle(tool.state) }}>{statusText}</Text>
                    ) : null}
                </div>
            </div>
            <div style={{ overflowX: 'auto' }}>
                <ResultView block={adaptedBlock} metadata={metadata} />
            </div>
        </div>
    )

    // 详情内容较长（diff / 终端输出常超屏）：peek 档先露一截，滚动/上推再展开——
    // 「查看详情」点开的常态就是长内容，peek 语义正合适
    return (
        <BottomSheet
            open={open}
            onClose={onClose}
            title={titleContent}
        >
            {/* Agent 工具：BubbleList 渲染 sidechain 对话 */}
            {isAgentTool(tool.name) ? (
                <AgentDrawerContent block={block} metadata={metadata} sessionId={sessionId} />
            ) : hasSpecialView ? (
                <>
                    <div style={sectionStyle}>
                        {/* 全高呈现：详情容器（sheet / 抽屉）自己就是滚动区，视图内不再限高内滚
                            （限高会在容器里嵌出第二层滚动区——真机反馈「diff 里为什么有竖向滚动条」） */}
                        <ToolViewScopeProvider fullHeight>
                            {FullView ? (
                                <FullView block={adaptedBlock} metadata={metadata} />
                            ) : CompactView ? (
                                <CompactView block={adaptedBlock} metadata={metadata} />
                            ) : null}
                        </ToolViewScopeProvider>
                    </div>
                    {/* 避免错误状态下重复渲染同一组件（FullView 与 ResultView 相同时） */}
                    {tool.state === 'error' && ResultView !== FullView && ResultView !== CompactView && (
                        <>
                            <div style={{ ...dividerStyle, marginLeft: 16, marginRight: 16 }} />
                            {renderOutputSection()}
                        </>
                    )}
                </>
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
                    {renderOutputSection()}
                </>
            )}
        </BottomSheet>
    )
}

export const ToolDetailDrawer = memo(ToolDetailDrawerInner)
