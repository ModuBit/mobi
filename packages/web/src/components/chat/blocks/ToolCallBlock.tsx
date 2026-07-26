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

import { useMemo, useState, useCallback, useEffect, useRef, memo } from 'react'
import { Think } from '@ant-design/x'
import { theme as antTheme } from 'antd'
import { Zap } from 'lucide-react'
import type { ChatBlock, ChatToolCall } from '@/domain/chat'
import { isObject } from '@mobi/shared'
import type { SessionMetadataSummary } from '@/core/data/api/types'
import type { MobiApi } from '@/core/data/api/client'
import type { ToolPermission } from '@/domain/tool/types'
import { getToolIcon, StatusStateIcon } from '@/components/tool-card/toolIcons'
import { getToolPresentation, isTerminalTool, isAgentTool, isBackgroundAgentTool, isBackgroundTool, isTeamAgentTool } from '@/components/tool-card/knownTools'
import { isExitPlanModeTool } from '@/core/lib/toolInputUtils'
import { getToolResultViewComponent } from '@/components/tool-card/views/_results'
import { getToolViewComponent } from '@/components/tool-card/views/_all'
import { ToolDetailDrawer } from '@/components/tool-card/ToolDetailDrawer'
import { OverflowContainer } from '@/components/ui/OverflowContainer'
import { FilePathText } from '@/components/ui/FilePathText'
import { PermissionFooter } from '@/components/tool-card/PermissionFooter'
import { AskUserQuestionFooter } from '@/components/tool-card/AskUserQuestionFooter'
import { isAskUserQuestionToolName } from '@/domain/tool/askUserQuestion'
import { Markdown } from '@/components/ui/Markdown'
import { getAgentPrompt } from '@/components/tool-card/index'
import { formatAgentMetrics } from '@/core/lib/metricsFormat'
import { useTranslation } from 'react-i18next'

/** 预览卡片最大高度 */
const PREVIEW_MAX_HEIGHT = {
    DEFAULT: 100,
    FILE: 200,
    TERMINAL: 160,
} as const

/** 默认展开的工具名 */
const EXPANDED_TOOL_NAMES = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'Bash', 'shell_command'])

/** 转换权限对象格式 */
function convertPermission(perm: NonNullable<ChatToolCall['permission']>): ToolPermission {
    return {
        id: perm.id,
        status: perm.status,
        reason: perm.reason,
        decision: perm.decision === 'denied' ? 'abort' as const : perm.decision === 'approved_for_session' ? 'approved_for_session' as const : perm.decision === 'approved' ? 'approved' as const : undefined,
        mode: perm.mode === 'acceptEdits' ? ('acceptEdits' as const) : undefined,
        allowedTools: perm.allowedTools,
        answers: perm.answers,
    }
}

function ToolCallPreviewContent({
    toolCallBlock,
    metadata,
    onViewDetail,
    showInput,
    maxHeight
}: {
    toolCallBlock: Extract<ChatBlock, { kind: 'tool-call' }>
    metadata: SessionMetadataSummary | null
    onViewDetail: () => void
    showInput?: boolean
    maxHeight: number
}) {
    const { t } = useTranslation()
    const { token } = antTheme.useToken()
    const tool = toolCallBlock.tool
    const terminalRunning = isTerminalTool(tool.name) && tool.state === 'running'
    const showToolInput = showInput || terminalRunning

    const ViewComponent = useMemo(() => {
        if (showToolInput) {
            return getToolViewComponent(tool.name)
        }
        return getToolResultViewComponent(tool.name)
    }, [showToolInput, tool.name])

    // 转换为 ToolCard/types.ToolCallBlock 格式
    const adaptedBlock = useMemo(() => {
        return {
            id: toolCallBlock.id,
            kind: 'tool-call' as const,
            tool: {
                name: tool.name,
                input: tool.input,
                result: showToolInput ? undefined : tool.result,
                state: tool.state,
                description: tool.description,
                startedAt: tool.startedAt,
                createdAt: tool.createdAt,
                permission: tool.permission ? convertPermission(tool.permission) : null,
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
                        permission: child.tool.permission ? convertPermission(child.tool.permission) : null,
                    },
                    children: [],
                })),
        }
    }, [toolCallBlock, tool, showToolInput])

    // 有权限请求 / 有结果 / Agent运行中 / 终端运行中 → 显示预览
    const isAgent = isAgentTool(tool.name)
    const agentRunning = isAgent && (tool.state === 'running' || tool.state === 'pending')
    const showPreview = showInput || (tool.state !== 'running' && tool.result !== undefined) || agentRunning || terminalRunning

    if (!showPreview) return null

    // Agent 工具运行中：有 summary 时显示 summary + 查看详情按钮，否则显示 prompt
    if (agentRunning) {
        const summary = toolCallBlock.tool.agentSummary
        if (summary) {
            return (
                <div style={{ marginTop: 4, paddingLeft: 12, paddingRight: 12 }}>
                    <div style={{
                        fontSize: 13, lineHeight: 1.5,
                        color: token.colorTextSecondary,
                        transition: 'opacity 0.15s',
                    }}>
                        {summary}
                    </div>
                    <div
                        onClick={(e) => { e.stopPropagation(); onViewDetail() }}
                        style={{
                            marginTop: 8, fontSize: 12,
                            color: token.colorPrimary,
                            cursor: 'pointer',
                        }}
                    >
                        {t('chat.tool.viewDetail')} →
                    </div>
                </div>
            )
        }
        const prompt = getAgentPrompt(tool.input)
        if (!prompt) return null
        return (
            <div style={{ marginTop: 4, paddingLeft: 12, paddingRight: 12 }}>
                <OverflowContainer maxHeight={maxHeight} onClickExpand={onViewDetail}>
                    <Markdown content={prompt} />
                </OverflowContainer>
            </div>
        )
    }

    // 后台 Agent：tool_result 快速返回后 state=completed，但任务仍在后台执行
    // 展示 agentSummary（来自 task_progress/task_notification），无 summary 时展示状态
    // 后台 agent 暂不支持 drawer
    if (isBackgroundAgentTool(tool.name, tool.input)) {
        const summary = toolCallBlock.tool.agentSummary
        return (
            <div style={{ marginTop: 4, paddingLeft: 12, paddingRight: 12 }}>
                <div style={{
                    fontSize: 13, lineHeight: 1.5,
                    color: token.colorTextSecondary,
                }}>
                    {summary ?? t('chat.backgroundTask.running', 'Running...')}
                </div>
            </div>
        )
    }

    // Team agent: 展示 agent name + team name + description
    if (isTeamAgentTool(tool.name, tool.input)) {
        const input = isObject(tool.input) ? tool.input : {}
        const agentName = typeof input.name === 'string' ? input.name : 'Agent'
        const teamName = typeof input.team_name === 'string' ? input.team_name : ''
        const description = typeof input.description === 'string' ? input.description : null

        return (
            <div style={{ marginTop: 4, paddingLeft: 12, paddingRight: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: token.colorText }}>
                    {agentName}
                    {teamName && (
                        <span style={{ fontSize: 11, fontWeight: 400, color: token.colorTextSecondary }}>
                            {' '}@ {teamName}
                        </span>
                    )}
                </div>
                {description && (
                    <div style={{ fontSize: 11, color: token.colorTextTertiary, marginTop: 2 }}>
                        {description}
                    </div>
                )}
            </div>
        )
    }

    // 后台 Bash：仅展示命令，不展示 output
    if (isTerminalTool(tool.name) && isObject(tool.input) && tool.input.run_in_background === true) {
        const command = typeof tool.input.command === 'string' ? tool.input.command : ''
        return (
            <div style={{ marginTop: 4, paddingLeft: 12, paddingRight: 12 }}>
                <div style={{
                    fontSize: 13, lineHeight: 1.5,
                    color: token.colorTextSecondary,
                    fontFamily: 'var(--font-mono)',
                    whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                }}>
                    {command || t('chat.backgroundTask.running', 'Running...')}
                </div>
            </div>
        )
    }

    if (!ViewComponent) return null

    return (
        <div style={{ marginTop: 4, paddingLeft: 12, paddingRight: 12 }}>
            <OverflowContainer maxHeight={maxHeight} onClickExpand={onViewDetail}>
                <ViewComponent block={adaptedBlock} metadata={metadata} />
            </OverflowContainer>
        </div>
    )
}

/** 渲染 ToolCallBlock（来自 reduceChatBlocks） */
export const ToolCallRenderer = memo(function ToolCallRenderer({ block, metadata, api, sessionId, disabled, onDone, disableDrawer }: {
    block: Extract<ChatBlock, { kind: 'tool-call' }>
    metadata: SessionMetadataSummary | null
    api?: MobiApi
    sessionId?: string
    disabled?: boolean
    onDone?: () => void
    disableDrawer?: boolean
}) {
    const { token } = antTheme.useToken()
    const tool = block.tool
    const isLoading = tool.state === 'running'
    const hasPermission = tool.permission && tool.permission.status === 'pending'
    const toolPresentation = getToolPresentation({
        toolName: tool.name,
        input: tool.input,
        result: tool.result,
        childrenCount: block.children?.length ?? 0,
        description: tool.description ?? null,
        metadata
    })

    const isAskUserQuestion = isAskUserQuestionToolName(tool.name)
    const askUserQuestionDone = isAskUserQuestion && !hasPermission
    const expandOnPermission = isExitPlanModeTool(tool.name)
    const permissionDrivenExpand = expandOnPermission && hasPermission
    const isError = tool.state === 'error'
    const isAgent = isAgentTool(tool.name)
    const isBgAgent = isBackgroundTool(tool.name, tool.input)
    const agentRunning = isAgent && (tool.state === 'running' || tool.state === 'pending')
    // 终端工具（Bash/shell_command）即报错也默认展开：用户主动下发的命令，
    // 失败/被拦截时必须直接看到命令与原因（如 mobi 本地 !bash 的高危拦截提示），
    // 不能像其它工具那样 error 即折叠降噪。
    const defaultExpanded = (!isError || isTerminalTool(tool.name)) && (EXPANDED_TOOL_NAMES.has(tool.name) || permissionDrivenExpand || askUserQuestionDone || agentRunning || isBgAgent)
    const [expanded, setExpanded] = useState(defaultExpanded)
    const prevPermissionDrivenExpand = useRef(permissionDrivenExpand)

    const prevIsError = useRef(isError)
    useEffect(() => {
        if (isError && !prevIsError.current && !isTerminalTool(tool.name)) {
            setExpanded(false)
        }
        prevIsError.current = isError
    }, [isError, tool.name])

    // 前台 Agent 完成时自动收起（后台 agent 不收起，保留 summary 展示）
    const prevAgentRunning = useRef(agentRunning)
    useEffect(() => {
        if (prevAgentRunning.current && !agentRunning && !isBgAgent) {
            setExpanded(false)
        }
        prevAgentRunning.current = agentRunning
    }, [agentRunning, isBgAgent])

    // ExitPlanMode: 审批结束后自动收起
    useEffect(() => {
        if (!expandOnPermission) return
        if (prevPermissionDrivenExpand.current && !permissionDrivenExpand) {
            setExpanded(false)
        }
        prevPermissionDrivenExpand.current = permissionDrivenExpand
    }, [expandOnPermission, permissionDrivenExpand])

    // AskUserQuestion: pending 时收起，回答/拒绝/中断后展开
    const prevAskUserQuestionPending = useRef(isAskUserQuestion && hasPermission)
    useEffect(() => {
        if (!isAskUserQuestion) return
        const wasPending = prevAskUserQuestionPending.current
        const isPending = hasPermission
        prevAskUserQuestionPending.current = isPending
        if (isPending) {
            setExpanded(false)
        } else if (wasPending && !isPending) {
            setExpanded(true)
        }
    }, [isAskUserQuestion, hasPermission])

    const [drawerOpen, setDrawerOpen] = useState(false)
    const drawerDisabled = disableDrawer || isBgAgent
    const handleViewDetail = useCallback(() => {
        if (drawerDisabled) return
        setDrawerOpen(true)
    }, [drawerDisabled])

    // 转换为 PermissionFooter 需要的 tool 格式
    const toolForPermission = useMemo(() => ({
        name: tool.name,
        input: tool.input,
        result: tool.result,
        state: tool.state,
        description: tool.description,
        startedAt: tool.startedAt,
        createdAt: tool.createdAt,
        permission: tool.permission ? convertPermission(tool.permission) : null,
    }), [tool])

    // 判断 title 是否已包含 description 信息
    // Agent 工具的 title 由 getAgentTitle 动态生成，不含 description 字段，或 title 等于/以 description 开头时跳过
    const titleContainsDescription = isAgentTool(tool.name)
        || (tool.description != null && (toolPresentation.title === tool.description || toolPresentation.title.startsWith(tool.description)))

    return (
        <>
            <Think
                className="tool-call-think"
                icon={
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <StatusStateIcon state={tool.state} />
                        {getToolIcon(tool.name)}
                    </span>
                }
                title={
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, overflow: 'hidden' }}>
                        {toolPresentation.isFilePath ? (
                            <FilePathText path={toolPresentation.title} />
                        ) : (
                            <span style={{ fontWeight: 500, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: '1 1 0', minWidth: 0 }}>
                                {toolPresentation.title}
                            </span>
                        )}
                        {isBgAgent && (
                            <Zap size={12} style={{ flexShrink: 0, color: '#f5b800' }} />
                        )}
                        {!titleContainsDescription && tool.description && (
                            <span style={{ fontSize: 11, color: token.colorTextTertiary, fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 1, minWidth: 0, maxWidth: '40%' }}>
                                {tool.description.length > 60 ? `${tool.description.slice(0, 60)}...` : tool.description}
                            </span>
                        )}
                        {tool.agentMetrics && (
                            <span style={{ fontSize: 11, color: token.colorTextQuaternary, fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', flexShrink: 0 }}>
                                {formatAgentMetrics(tool.agentMetrics)}
                            </span>
                        )}
                    </div>
                }
                blink={isLoading}
                expanded={expanded}
                onExpand={setExpanded}
            >
                {/* AskUserQuestion pending 时跳过默认预览，由 AskUserQuestionFooter 接管 */}
                {!(isAskUserQuestion && hasPermission) && (
                    <ToolCallPreviewContent
                        toolCallBlock={block}
                        metadata={metadata}
                        onViewDetail={handleViewDetail}
                        showInput={hasPermission}
                        maxHeight={toolPresentation.previewMaxHeight
                            ?? (isTerminalTool(tool.name) ? PREVIEW_MAX_HEIGHT.TERMINAL
                            : PREVIEW_MAX_HEIGHT.DEFAULT)}
                    />
                )}
                {/* pending 状态显示操作按钮 */}
                {hasPermission && api && sessionId ? (
                    <div style={{ marginTop: 8, paddingLeft: 12, paddingRight: 12 }}>
                        {isAskUserQuestion ? (
                            <AskUserQuestionFooter
                                api={api}
                                sessionId={sessionId}
                                tool={toolForPermission}
                                disabled={disabled ?? false}
                                onDone={onDone ?? (() => {})}
                            />
                        ) : (
                            <PermissionFooter
                                api={api}
                                sessionId={sessionId}
                                metadata={metadata}
                                tool={toolForPermission}
                                disabled={disabled ?? false}
                                onDone={onDone ?? (() => {})}
                            />
                        )}
                    </div>
                ) : null}
            </Think>
            {!drawerDisabled && (
                <ToolDetailDrawer
                    block={block}
                    metadata={metadata}
                    open={drawerOpen}
                    onClose={() => setDrawerOpen(false)}
                    sessionId={sessionId}
                />
            )}
        </>
    )
})
