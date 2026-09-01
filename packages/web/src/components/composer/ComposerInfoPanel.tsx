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

import { useMemo, useRef, useState, useEffect, useCallback, type ReactNode } from 'react'
import { Space, Typography, theme as antTheme } from 'antd'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { isAxiosError } from 'axios'
import { ExclamationCircleOutlined } from '@ant-design/icons'
import { ChevronDown } from 'lucide-react'
import type { AgentState, SessionMetadataSummary, DecryptedMessage } from '@/core/data/api/types'
import type { MobiApi } from '@/core/data/api/client'
import type { SDKUIHints, TodoItem, TaskItem, PermissionUpdate, PermissionAnswers } from '@mobi/shared'
import { PermissionFooter, getPermissionDisplayText } from '@/components/tool-card/PermissionFooter'
import { AskUserQuestionFooter } from '@/components/tool-card/AskUserQuestionFooter'
import { RequestUserInputFooter } from '@/components/tool-card/RequestUserInputFooter'
import { isAskUserQuestionToolName, joinQuestionHeaders } from '@/domain/tool/askUserQuestion'
import { isRequestUserInputToolName } from '@/domain/tool/requestUserInput'
import { isElicitationToolName, parseElicitationPayload } from '@/domain/tool/elicitation'
import { ElicitationFormCard } from '@/components/chat/ElicitationFormCard'
import type { ComposerSegments } from '@/domain/chat/composerSegments'
import { getPermissionDescription } from '@/core/lib/toolInputUtils'
import { queryKeys } from '@/core/lib/query-keys'
import { useRunningAgents } from '@/core/data/stores/runningAgentsStore'
import { useChatBlocksById } from '@/core/data/stores/chatBlocksByIdStore'
import { useBackgroundTasks } from '@/core/data/stores/backgroundTasksStore'
import { ToolDetailDrawer } from '@/components/tool-card/ToolDetailDrawer'
import { TodoPanel } from './TodoPanel'
import type { ClearRuntimeStateField } from './ClearStateButton'
import { TaskPanel } from './TaskPanel'
import { TasksPanel } from './TasksPanel'
import { TeamAgentPanel } from './TeamAgentPanel'
import { useTeamMembers, useTeamName } from '@/core/data/stores/teamAgentsStore'
import type { ToolCallBlock } from '@/domain/chat/types'
import { useMessages } from '@/core/data/hooks/queries/useMessages'
import { isQueuedInMobi } from '@/core/lib/messages'
import { QueuedMessagesBar } from '@/components/chat/QueuedMessagesBar'

const { Text } = Typography
const { useToken } = antTheme

/** loading 期稳定空数组默认值，避免每次渲染新建 [] 引用抖动 */
const EMPTY_MESSAGES: DecryptedMessage[] = []

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
    const { t } = useTranslation()

    // 转换为各 Footer 组件需要的格式
    const pendingRequests = useMemo(() => {
        if (!requests) return []
        return Object.entries(requests).map(([requestId, request]) => {
            // mcp_elicitation 由独立 ElicitationFormCard 消费（spec D1 渲染层分流），不进通用审批卡
            if (isElicitationToolName(request.tool)) return null
            const req = request as {
                tool?: string; arguments?: unknown; createdAt?: number | null
                sdkHints?: SDKUIHints
                suggestions?: PermissionUpdate[]
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
                    createdAt: req.createdAt ?? null,
                    suggestions: req.suggestions,
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
        }).filter((entry) => entry !== null)
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
                    : getPermissionDisplayText(tool.permission, tool.name, tool.input, t, tool.sdkHints)
                // 具体授权内容（Bash 命令/文件路径等）；与 titleText 去重避免重复显示
                const detail = (isAskUserQuestion || isRequestUserInput)
                    ? null
                    : getPermissionDescription(tool.name, tool.input)
                const subtitle = detail && !titleText.includes(detail) ? detail : undefined

                return (
                    <ToolRequestCard
                        key={id}
                        testId={`tool-request-toggle-${id}`}
                        titleText={titleText}
                        subtitle={subtitle}
                        footerNode={footerNode}
                    />
                )
            })}
        </div>
    )
}

/** 判定「请求已被处理」的 404（首次提交成功但 SSE 滞后致卡片残留，用户重复点击）：静默收起不报错 */
function isPermissionRequestGone(e: unknown): boolean {
    if (!isAxiosError(e) || e.response?.status !== 404) return false
    const data = e.response.data as { code?: string; error?: string } | undefined
    return data?.code === 'permission_request_gone' || data?.error === 'Request not found'
}

/**
 * Elicitation 表单区（批次 C，spec D1 渲染层分流）：过滤 agentState.requests 的 mcp_elicitation
 * 条目逐个渲染 ElicitationFormCard。提交/拒绝复用既有审批提交 API（approve 带 answers 通道，spec D3）；
 * 成功（或 404 已处理）后失效 session 重拉 agentState——卡片随条目从 requests 移除而卸载（spec D5），
 * 本区不维护「已提交」本地态。
 */
function ElicitationRequestsSection({
    requests,
    api,
    sessionId,
    disabled,
    onDone,
}: {
    requests: AgentState['requests']
    api: MobiApi
    sessionId: string
    disabled: boolean
    onDone: () => void
}) {
    const { t } = useTranslation()
    const queryClient = useQueryClient()
    const [submitError, setSubmitError] = useState<string | null>(null)
    // 正在提交的 requestId（approve/deny await 期间 disable 对应卡片，防双击重复请求）
    const [submittingId, setSubmittingId] = useState<string | null>(null)

    const entries = useMemo(
        () => Object.entries(requests ?? {}).filter(([, request]) => isElicitationToolName(request.tool)),
        [requests],
    )
    if (entries.length === 0) return null

    // 与 PermissionFooter.run 同口径：成功或「已被处理」都失效 session 让 UI 立即移除卡片
    const settle = () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.session(sessionId) })
        onDone()
    }

    const run = async (id: string, action: () => Promise<unknown>) => {
        setSubmitError(null)
        setSubmittingId(id)
        try {
            await action()
        } catch (e) {
            if (!isPermissionRequestGone(e)) {
                setSubmitError(e instanceof Error ? e.message : t('chat.tool.requestFailed'))
                return
            }
        } finally {
            setSubmittingId(null)
        }
        settle()
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {entries.map(([id, request]) => {
                // arguments 缺失/形态不符时给空载荷兜底渲染：至少保留拒绝出口，避免 pending 卡死
                const payload = parseElicitationPayload(request.arguments)
                    ?? { serverName: '', message: '', requestedSchema: null }
                return (
                    <ElicitationFormCard
                        key={id}
                        requestId={id}
                        serverName={payload.serverName}
                        message={payload.message}
                        requestedSchema={payload.requestedSchema}
                        sdkHints={request.sdkHints}
                        disabled={disabled || submittingId === id}
                        onSubmit={(answers: PermissionAnswers) => run(id, () => api.permissions.approve(sessionId, id, { answers }))}
                        onDecline={(reason?: string) => run(id, () => api.permissions.deny(sessionId, id, reason ? { reason } : undefined))}
                    />
                )
            })}
            {submitError ? (
                <div style={{ fontSize: 12, color: 'var(--ant-color-error)' }} role="alert">{submitError}</div>
            ) : null}
        </div>
    )
}

/**
 * 单个工具交互请求卡片：标题区（图标 + 标题 + 展开箭头）作为折叠头，
 * 折叠/展开能力上移到此层，Footer 自身不再含折叠头（消除两层标题头语义重复）。
 * 中性背景/边框避免与 Footer 内层中性组件色温断裂；attention 浓缩到左侧图标。
 */
function ToolRequestCard({ titleText, subtitle, footerNode, testId }: {
    titleText: string
    subtitle?: string
    footerNode: ReactNode
    testId: string
}) {
    const { token } = useToken()
    const [collapsed, setCollapsed] = useState(false)
    const reducedMotion = typeof window !== 'undefined' && window.matchMedia
        ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
        : false

    return (
        <div style={{
            padding: 12,
            background: token.colorBgContainer,
            border: `1px solid ${token.colorBorderSecondary}`,
            borderRadius: 8,
        }}>
            <button
                type="button"
                data-testid={testId}
                aria-expanded={!collapsed}
                aria-controls={`${testId}-panel`}
                onClick={() => setCollapsed((c) => !c)}
                style={{
                    display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                    minHeight: 32, cursor: 'pointer',
                    color: token.colorText, fontSize: 13, fontWeight: 500,
                    background: 'transparent', border: 'none', padding: 0, textAlign: 'left',
                }}
            >
                <ExclamationCircleOutlined style={{ color: token.colorWarningText, fontSize: 14, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <Text strong style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {titleText}
                    </Text>
                    {subtitle ? (
                        <Text style={{
                            fontSize: 12, color: token.colorTextTertiary,
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            fontFamily: titleText.includes('Bash') ? 'monospace' : undefined,
                        }}>
                            {subtitle}
                        </Text>
                    ) : null}
                </div>
                <ChevronDown
                    size={14}
                    style={{
                        flexShrink: 0, color: token.colorTextTertiary,
                        transform: collapsed ? 'none' : 'rotate(180deg)',
                        transition: reducedMotion ? 'none' : 'transform .2s',
                    }}
                />
            </button>
            {!collapsed ? (
                <div id={`${testId}-panel`} style={{ marginTop: 8 }}>{footerNode}</div>
            ) : null}
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
    /** 排队消息编辑回填：把取消成功的排队消息完整分段写回 composer 并聚焦 */
    onEditQueued: (segments: ComposerSegments) => void
}

/**
 * 排队消息区：独立订阅排队消息子集。
 * 父面板只订阅「是否存在排队」布尔（见下 useMessages）；此处再开一个观察者取排队数组，
 * useSyncExternalStore 按 sessionId 共享同一 messageWindowStore，不发额外请求。
 *
 * 注意：与原 react-query 不同——store 每次 SSE 写入都 notify（无结构化共享），
 * 本组件会随消息变动重渲染。已知 trade-off（select 在 hook body 不触发无限循环，
 * getSnapshot 返回稳定 state 引用）；若流式期 reconcile 开销显著，后续加 selector 缓存。
 */
function QueuedMessagesSection({
    sessionId,
    onEdit,
}: {
    sessionId: string
    onEdit: (segments: ComposerSegments) => void
}) {
    // 只取排队子集。cancelled/discarded 终态消息不进 composer 区——
    // 终态可见性由聊天流内的灰色标注承担（ChatContainer footer 标注）
    const { data: messages = EMPTY_MESSAGES } = useMessages(sessionId, (all) => all.filter(isQueuedInMobi))
    if (messages.length === 0) return null
    return (
        <QueuedMessagesBar
            sessionId={sessionId}
            messages={messages}
            onEdit={onEdit}
        />
    )
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
    tasks,
    onEditQueued,
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
    const hasAgents = agents.length > 0

    // 只订阅「是否存在排队消息」布尔（hasContent 门禁信号，无第二个消费者）。
    // useSyncExternalStore 下 store 每次 SSE 写入都 notify，
    // 本面板会随消息变动重渲染——已知 trade-off（不无限循环；getSnapshot 返回稳定 state 引用）。
    // 若流式期 ToolInteractionPanel/TasksPanel 等重型子树 reconcile 开销显著，后续加 selector 缓存优化。
    const { data: hasQueued = false } = useMessages(sessionId, (all) => all.some(isQueuedInMobi))

    // 从 store 派生最新 block：先查 running agents，再查 byId（覆盖后台 Agent 任务）
    const drawerBlock: ToolCallBlock | null = (() => {
        if (!drawerBlockId) return null
        const fromAgents = agents.find(a => a.block.id === drawerBlockId)?.block
        if (fromAgents) return fromAgents
        const fromById = byIdMap.get(drawerBlockId)
        return fromById?.kind === 'tool-call' ? fromById : null
    })()
    const { token } = useToken()

    const scrollRef = useRef<HTMLDivElement>(null)
    const [showFade, setShowFade] = useState(false)

    // 是否渲染了滚动容器（有任何内容面板）。
    // ResizeObserver effect 依赖它而非 []：空挂载时组件 return null、scrollRef 为 null，
    // 若用 [] 依赖，effect 只在 mount 跑一次（此时 el=null 直接 return），之后内容出现也不重跑
    // → observer 永不挂载、showFade 恒 false。依赖 hasContent 后，内容后于挂载出现时 effect 重跑、observer 才挂上。
    const hasContent = Boolean(hasPendingRequests || hasTodos || hasTasks || hasAgents || hasBgTasks || hasTeamAgents || hasQueued)
    useEffect(() => {
        if (!hasContent) return
        const el = scrollRef.current
        if (!el) return
        const observer = new ResizeObserver(() => {
            setShowFade(el.scrollHeight > el.clientHeight)
        })
        observer.observe(el)
        return () => observer.disconnect()
    }, [hasContent])

    // 清理运行时状态字段的回调
    const handleClearState = useCallback(async (clearSessionId: string, clearFields: ClearRuntimeStateField[]) => {
        await api.sessions.clearRuntimeStateFields(clearSessionId, clearFields)
    }, [api])

    if (!hasContent) return null

    return (
        <div style={{ position: 'relative', padding: '8px 0', marginBottom: 4 }}>
            <div
                ref={scrollRef}
                className="hide-scrollbar"
                style={{ maxHeight: '40dvh', overflow: 'auto' }}
            >
                <Space orientation="vertical" size={8} style={{ width: '100%' }}>
                    <QueuedMessagesSection
                        sessionId={sessionId}
                        onEdit={onEditQueued}
                    />

                    <ElicitationRequestsSection
                        requests={agentState?.requests}
                        api={api}
                        sessionId={sessionId}
                        disabled={disabled}
                        onDone={onRequestDone}
                    />

                    <ToolInteractionPanel
                        requests={agentState?.requests}
                        metadata={metadata}
                        api={api}
                        sessionId={sessionId}
                        disabled={disabled}
                        onDone={onRequestDone}
                    />

                    <TasksPanel
                        sessionId={sessionId}
                        api={api}
                        onAgentClick={(block) => setDrawerBlockId(block.id)}
                        onTaskClick={(task) => {
                            // 先查后设（C1）：点击时先在 agents/byIdMap 里解析 toolUseId 对应的
                            // tool-call block，查到才设置 drawerBlockId——同时消灭「静默设置后不渲染」
                            // 与「残留 id 之后无操作自动弹开」两个症状。
                            // 窗口外 block 点击无反馈是已知限制（查询即守卫，不残留状态）
                            const blockId = task.toolUseId
                            const found = blockId != null
                                ? agents.find(a => a.block.id === blockId)?.block ?? byIdMap.get(blockId)
                                : undefined
                            if (found?.kind === 'tool-call') setDrawerBlockId(found.id)
                        }}
                        onClear={handleClearState}
                    />

                    <TeamAgentPanel sessionId={sessionId} onClear={handleClearState} />

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
