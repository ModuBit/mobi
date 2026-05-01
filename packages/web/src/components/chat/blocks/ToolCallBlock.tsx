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

import { useMemo, useState, useCallback } from 'react'
import { Think } from '@ant-design/x'
import { theme as antTheme } from 'antd'
import type { ChatBlock, ChatToolCall } from '@/domain/chat'
import type { SessionMetadataSummary } from '@/core/data/api/types'
import type { MobiApi } from '@/core/data/api/client'
import type { ToolPermission } from '@/domain/tool/types'
import { getToolIcon, StatusStateIcon } from '@/components/tool-card/toolIcons'
import { getToolPresentation, isTerminalTool, isAgentTool } from '@/components/tool-card/knownTools'
import { getToolResultViewComponent } from '@/components/tool-card/views/_results'
import { getToolViewComponent } from '@/components/tool-card/views/_all'
import { ToolDetailDrawer } from '@/components/tool-card/ToolDetailDrawer'
import { OverflowContainer } from '@/components/ui/OverflowContainer'
import { FilePathText } from '@/components/ui/FilePathText'
import { PermissionFooter } from '@/components/tool-card/PermissionFooter'

/** 预览卡片最大高度 */
const PREVIEW_MAX_HEIGHT = {
    DEFAULT: 100,
    FILE: 200,
    TERMINAL: 160,
} as const

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
    const tool = toolCallBlock.tool
    const ViewComponent = useMemo(() => {
        if (showInput) {
            return getToolViewComponent(tool.name)
        }
        return getToolResultViewComponent(tool.name)
    }, [showInput, tool.name])

    // 转换为 ToolCard/types.ToolCallBlock 格式
    const adaptedBlock = useMemo(() => {
        return {
            id: toolCallBlock.id,
            kind: 'tool-call' as const,
            tool: {
                name: tool.name,
                input: tool.input,
                result: showInput ? undefined : (tool.result ?? undefined),
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
    }, [toolCallBlock, tool, showInput])

    // 输入预览：有权限请求时显示
    // 结果预览：非运行状态且有结果时显示
    const showPreview = showInput || (tool.state !== 'running' && tool.result !== undefined)

    if (!showPreview || !ViewComponent) return null

    return (
        <div style={{ marginTop: 4, paddingLeft: 12, paddingRight: 12 }}>
            <OverflowContainer maxHeight={maxHeight} onClickExpand={onViewDetail}>
                <ViewComponent block={adaptedBlock} metadata={metadata} />
            </OverflowContainer>
        </div>
    )
}

/** 渲染 ToolCallBlock（来自 reduceChatBlocks） */
export function ToolCallRenderer({ block, metadata, api, sessionId, disabled, onDone, disableDrawer }: {
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

    // Agent 工具和最小化工具默认收起，其他默认展开
    const defaultExpanded = !isAgentTool(tool.name) && !toolPresentation.minimal
    const [expanded, setExpanded] = useState(defaultExpanded)
    const [drawerOpen, setDrawerOpen] = useState(false)
    const handleViewDetail = useCallback(() => {
        if (disableDrawer) return
        setDrawerOpen(true)
    }, [disableDrawer])

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
    // Agent 工具的 title 由 getAgentTitle 动态生成，不含 description 字段，或 title 等于 description 时跳过
    const titleContainsDescription = isAgentTool(tool.name)
        || (tool.description != null && toolPresentation.title === tool.description)

    return (
        <>
            <Think
                className="tool-call-think"
                icon={getToolIcon(tool.name, { id: block.id, state: tool.state })}
                title={
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, overflow: 'hidden' }}>
                        {toolPresentation.isFilePath ? (
                            <FilePathText path={toolPresentation.title} />
                        ) : (
                            <span style={{ fontWeight: 500, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: '1 1 0', minWidth: 0 }}>
                                {toolPresentation.title}
                            </span>
                        )}
                        {!titleContainsDescription && tool.description && (
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
                    onViewDetail={handleViewDetail}
                    showInput={hasPermission}
                    maxHeight={toolPresentation.isFilePath ? PREVIEW_MAX_HEIGHT.FILE
                        : isTerminalTool(tool.name) ? PREVIEW_MAX_HEIGHT.TERMINAL
                        : PREVIEW_MAX_HEIGHT.DEFAULT}
                />
                {/* pending 状态显示权限操作按钮 */}
                {hasPermission && api && sessionId ? (
                    <div style={{ marginTop: 8, paddingLeft: 12, paddingRight: 12 }}>
                        <PermissionFooter
                            api={api}
                            sessionId={sessionId}
                            metadata={metadata}
                            tool={toolForPermission}
                            disabled={disabled ?? false}
                            onDone={onDone ?? (() => {})}
                        />
                    </div>
                ) : null}
            </Think>
            {!disableDrawer && (
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
}
