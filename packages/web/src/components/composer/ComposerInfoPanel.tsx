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
 * Composer 信息面板
 * 在输入区上方展示各种状态信息：工具交互请求、任务列表、文件修改等
 */

import { useMemo, useRef, useState, useEffect, useCallback } from 'react'
import { Space, Typography, theme as antTheme } from 'antd'
import { useTranslation } from 'react-i18next'
import { ExclamationCircleOutlined } from '@ant-design/icons'
import type { AgentState, SessionMetadataSummary } from '@/core/data/api/types'
import { getCustomPermissionTitleKey } from '@/core/lib/toolInputUtils'
import type { MobiApi } from '@/core/data/api/client'
import type { SDKUIHints, TodoItem, TaskItem } from '@mobi/shared'
import { PermissionFooter } from '@/components/tool-card/PermissionFooter'
import { AskUserQuestionFooter } from '@/components/tool-card/AskUserQuestionFooter'
import { RequestUserInputFooter } from '@/components/tool-card/RequestUserInputFooter'
import { isAskUserQuestionToolName, joinQuestionHeaders } from '@/domain/tool/askUserQuestion'
import { isRequestUserInputToolName } from '@/domain/tool/requestUserInput'
import { AgentPanel } from './AgentPanel'
import { useRunningAgents } from '@/core/data/stores/runningAgentsStore'
import { useChatBlocksById } from '@/core/data/stores/chatBlocksByIdStore'
import { ToolDetailDrawer } from '@/components/tool-card/ToolDetailDrawer'
import { TodoPanel } from './TodoPanel'
import { TaskPanel } from './TaskPanel'
import { BackgroundTaskPanel } from './BackgroundTaskPanel'
import { useBackgroundTasks } from '@/core/data/stores/backgroundTasksStore'
import { TeamAgentPanel } from './TeamAgentPanel'
import { useTeamMembers, useTeamName } from '@/core/data/stores/teamAgentsStore'
import type { ToolCallBlock } from '@/domain/chat/types'

const { Text } = Typography
const { useToken } = antTheme

/** 工具交互请求面板：根据工具类型分发不同的交互组件 */
function ToolInteractionPanel({
    requests,
    metadata,
    api,
    sessionId,
    disabled,
    onDone
}: {
    requests: AgentState['requests']
    metadata: SessionMetadataSummary | null
    api: MobiApi
    sessionId: string
    disabled: boolean
    onDone: () => void
}) {
    const { token } = useToken()
    const { t } = useTranslation()

    // 转换为各 Footer 组件需要的格式
    const pendingRequests = useMemo(() => {
        if (!requests) return []
        return Object.entries(requests).map(([requestId, request]) => {
            const req = request as {
                tool?: string; arguments?: unknown; createdAt?: number | null
                sdkHints?: SDKUIHints
            }
            const toolName = req.tool || 'Unknown'
            const tool = {
                name: toolName,
                input: req.arguments,
                result: undefined,
                state: 'running' as const,
                description: null,
                startedAt: null,
                createdAt: req.createdAt ?? Date.now(),
                permission: {
                    id: requestId,
                    status: 'pending' as const,
                    createdAt: req.createdAt ?? null
                },
                sdkHints: req.sdkHints,
            }
            return {
                id: requestId,
                tool,
                isAskUserQuestion: isAskUserQuestionToolName(toolName),
                isRequestUserInput: isRequestUserInputToolName(toolName),
                askUserQuestionHeader: isAskUserQuestionToolName(toolName)
                    ? joinQuestionHeaders(req.arguments) ?? undefined
                    : undefined,
            }
        })
    }, [requests])

    if (pendingRequests.length === 0) return null

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {pendingRequests.map(({ id, tool, isAskUserQuestion, isRequestUserInput, askUserQuestionHeader }) => {
                const footerNode = isAskUserQuestion ? (
                    <AskUserQuestionFooter
                        api={api}
                        sessionId={sessionId}
                        tool={tool}
                        disabled={disabled}
                        onDone={onDone}
                    />
                ) : isRequestUserInput ? (
                    <RequestUserInputFooter
                        sessionId={sessionId}
                        tool={tool}
                        disabled={disabled}
                        onDone={onDone}
                    />
                ) : (
                    <PermissionFooter
                        api={api}
                        sessionId={sessionId}
                        metadata={metadata}
                        tool={tool}
                        disabled={disabled}
                        onDone={onDone}
                    />
                )

                const titleText = isAskUserQuestion
                    ? (askUserQuestionHeader || t('chat.tool.askUserQuestion.title'))
                    : (() => {
                        const customKey = getCustomPermissionTitleKey(tool.name)
                        if (customKey) return t(customKey)
                        return tool.sdkHints?.displayName
                            ? t('chat.permission.toolRequest', { tool: tool.sdkHints.displayName })
                            : t('chat.permission.title')
                    })()

                return (
                    <div key={id} style={{
                        padding: 12,
                        background: token.colorWarningBg,
                        border: `1px solid ${token.colorWarningBorder}`,
                        borderRadius: 8
                    }}>
                        <div style={{ marginBottom: 8 }}>
                            <Text strong>
                                <ExclamationCircleOutlined style={{ color: token.colorWarningText, marginRight: 8 }} />
                                {titleText}
                            </Text>
                        </div>
                        {footerNode}
                    </div>
                )
            })}
        </div>
    )
}

export type ComposerInfoPanelProps = {
    sessionId: string
    agentState: AgentState | null | undefined
    metadata: SessionMetadataSummary | null
    api: MobiApi
    disabled: boolean
    onRequestDone: () => void
    todos?: TodoItem[]
    tasks?: TaskItem[]
}

/**
 * Composer 信息面板
 * 在输入区上方展示各种状态信息
 */
export function ComposerInfoPanel({
    sessionId,
    agentState,
    metadata,
    api,
    disabled,
    onRequestDone,
    todos,
    tasks
}: ComposerInfoPanelProps) {
    const [drawerBlockId, setDrawerBlockId] = useState<string | null>(null)
    const hasPendingRequests = agentState?.requests && Object.keys(agentState.requests).length > 0
    const hasTodos = todos && todos.length > 0
    const hasTasks = tasks && tasks.some(t => t.status !== 'deleted')
    const agents = useRunningAgents(sessionId)
    const byIdMap = useChatBlocksById(sessionId)
    const bgTasks = useBackgroundTasks(sessionId)
    const hasBgTasks = bgTasks.length > 0
    const teamAgents = useTeamMembers(sessionId)
    const teamName = useTeamName(sessionId)
    const hasTeamAgents = teamAgents.length > 0 && !!teamName

    // 从 store 派生最新 block：先查 running agents，再查 byId（覆盖后台 Agent 任务）
    const drawerBlock: ToolCallBlock | null = (() => {
        if (!drawerBlockId) return null
        const fromAgents = agents.find(a => a.block.id === drawerBlockId)?.block
        if (fromAgents) return fromAgents
        const fromById = byIdMap.get(drawerBlockId)
        return fromById?.kind === 'tool-call' ? fromById : null
    })()
    const hasAgents = agents.length > 0
    const { token } = useToken()

    const scrollRef = useRef<HTMLDivElement>(null)
    const [showFade, setShowFade] = useState(false)

    // ResizeObserver 检测内容溢出，比 setTimeout + useMemo 更可靠
    useEffect(() => {
        const el = scrollRef.current
        if (!el) return
        const observer = new ResizeObserver(() => {
            setShowFade(el.scrollHeight > el.clientHeight)
        })
        observer.observe(el)
        return () => observer.disconnect()
    }, [])

    // 清理运行时状态字段的回调
    const handleClearState = useCallback(async (clearSessionId: string, clearFields: ('todos' | 'tasks' | 'backgroundTasks' | 'teamState')[]) => {
        await api.sessions.clearRuntimeStateFields(clearSessionId, clearFields)
    }, [api])

    if (!hasPendingRequests && !hasTodos && !hasTasks && !hasAgents && !hasBgTasks && !hasTeamAgents) return null

    return (
        <div style={{ position: 'relative', padding: '8px 0', marginBottom: 4 }}>
            <div
                ref={scrollRef}
                className="hide-scrollbar"
                style={{ maxHeight: '40dvh', overflow: 'auto' }}
            >
                <Space orientation="vertical" size={8} style={{ width: '100%' }}>
                    <ToolInteractionPanel
                        requests={agentState?.requests}
                        metadata={metadata}
                        api={api}
                        sessionId={sessionId}
                        disabled={disabled}
                        onDone={onRequestDone}
                    />

                    <AgentPanel
                        sessionId={sessionId}
                        onAgentClick={(block) => setDrawerBlockId(block.id)}
                    />

                    <TeamAgentPanel sessionId={sessionId} onClear={handleClearState} />

                    {hasBgTasks && (
                        <BackgroundTaskPanel
                            sessionId={sessionId}
                            api={api}
                            onTaskClick={() => {}}
                            onClear={handleClearState}
                        />
                    )}

                    <TodoPanel todos={todos} sessionId={sessionId} onClear={handleClearState} />
                    <TaskPanel tasks={tasks} sessionId={sessionId} onClear={handleClearState} />
                </Space>
            </div>
            {showFade && (
                <div style={{
                    position: 'absolute',
                    bottom: 4,
                    left: 0,
                    right: 0,
                    height: 24,
                    background: `linear-gradient(transparent, ${token.colorBgLayout})`,
                    pointerEvents: 'none',
                }} />
            )}
            {drawerBlock && (
                <ToolDetailDrawer
                    block={drawerBlock}
                    metadata={metadata}
                    open={!!drawerBlock}
                    onClose={() => setDrawerBlockId(null)}
                    sessionId={sessionId}
                />
            )}
        </div>
    )
}
