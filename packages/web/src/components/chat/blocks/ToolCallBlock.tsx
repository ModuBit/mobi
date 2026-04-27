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

import { useMemo, useState } from 'react'
import { Think } from '@ant-design/x'
import { theme as antTheme } from 'antd'
import type { ChatBlock, ChatToolCall } from '@/domain/chat'
import type { SessionMetadataSummary } from '@/core/data/api/types'
import type { MobiApi } from '@/core/data/api/client'
import type { ToolPermission } from '@/domain/tool/types'
import { getToolIcon, StatusStateIcon } from '@/components/tool-card/toolIcons'
import { getToolPresentation } from '@/components/tool-card/knownTools'
import { getToolResultViewComponent } from '@/components/tool-card/views/_results'
import { getToolViewComponent } from '@/components/tool-card/views/_all'
import { ToolDetailDrawer } from '@/components/tool-card/ToolDetailDrawer'
import { OverflowContainer } from '@/components/ui/OverflowContainer'
import { PermissionFooter } from '@/components/tool-card/PermissionFooter'

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

/** 工具预览内容（在 Think 展开区域内渲染） */
function ToolCallPreviewContent({
    toolCallBlock,
    metadata,
    onViewDetail,
    showInput
}: {
    toolCallBlock: Extract<ChatBlock, { kind: 'tool-call' }>
    metadata: SessionMetadataSummary | null
    onViewDetail: () => void
    showInput?: boolean
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
            <OverflowContainer maxHeight={100} onClickExpand={onViewDetail}>
                <ViewComponent block={adaptedBlock} metadata={metadata} />
            </OverflowContainer>
        </div>
    )
}

/** 渲染 ToolCallBlock（来自 reduceChatBlocks） */
export function ToolCallRenderer({ block, metadata, api, sessionId, disabled, onDone }: {
    block: Extract<ChatBlock, { kind: 'tool-call' }>
    metadata: SessionMetadataSummary | null
    api?: MobiApi
    sessionId?: string
    disabled?: boolean
    onDone?: () => void
}) {
    const { token } = antTheme.useToken()
    const [expanded, setExpanded] = useState(true)
    const [drawerOpen, setDrawerOpen] = useState(false)

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
                    showInput={hasPermission}
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
            <ToolDetailDrawer
                block={block}
                metadata={metadata}
                open={drawerOpen}
                onClose={() => setDrawerOpen(false)}
            />
        </>
    )
}
