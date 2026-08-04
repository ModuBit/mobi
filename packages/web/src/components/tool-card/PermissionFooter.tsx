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

import type { MobiApi } from '@/core/data/api/client'
import type { SessionMetadataSummary } from '@/core/data/api/types'
import type { ToolInfo, ToolPermission } from '@/domain/tool/types'
import type { PermissionUpdate, PermissionUpdateDestination, SDKUIHints } from '@mobi/shared'
import { memo, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { isAxiosError } from 'axios'
import { Alert, Button, Input, theme as antTheme } from 'antd'
import { CheckOutlined, CloseOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { agentCardBg } from '@/components/composer/agentPalette'
import { useUiStore, resolveTheme } from '@/core/data/stores/uiStore'
import { useIsMobile } from '@/core/data/hooks/useMediaQuery'
import { queryKeys } from '@/core/lib/query-keys'
import { getCustomPermissionTitleKey, getInputStringAny, getPermissionDescription, isExitPlanModeTool } from '@/core/lib/toolInputUtils'

const { useToken } = antTheme

/** destination → i18n key。cliArg 归并到「允许本次」（不单独渲染按钮） */
const DESTINATION_LABEL_KEY: Record<PermissionUpdateDestination, string> = {
    session: 'chat.tool.allowSession',
    localSettings: 'chat.tool.allowProjectLocal',
    projectSettings: 'chat.tool.allowProject',
    userSettings: 'chat.tool.allowUser',
    cliArg: 'chat.tool.allow',
}

/** destination 排序：由窄到宽 */
const DESTINATION_ORDER: PermissionUpdateDestination[] = ['session', 'localSettings', 'projectSettings', 'userSettings']

/** 按 destination 分组排序 SDK suggestions，cliArg 不单独出按钮 */
function groupSuggestionsByDestination(suggestions: PermissionUpdate[] | undefined): { destination: PermissionUpdateDestination; items: PermissionUpdate[] }[] {
    if (!suggestions || suggestions.length === 0) return []
    const groups = new Map<PermissionUpdateDestination, PermissionUpdate[]>()
    for (const s of suggestions) {
        const dest = s.destination
        if (dest === 'cliArg') continue
        if (!groups.has(dest)) groups.set(dest, [])
        groups.get(dest)!.push(s)
    }
    return [...groups.entries()]
        .sort((a, b) => DESTINATION_ORDER.indexOf(a[0]) - DESTINATION_ORDER.indexOf(b[0]))
        .map(([destination, items]) => ({ destination, items }))
}

/**
 * SDK 无 suggestion 时，构造 session 档回退 mobi Set 兜底：
 * Bash 用 command 字面作 ruleContent（CLI parseBashPermission 字面填 Set），
 * 非 Bash 用 toolName（CLI allowedTools.add 填整个工具）。
 * CLI 收到后填 mobi Set，下次同工具/命令命中放行，真正跨 turn 持久。
 */
function buildFallbackUpdate(toolName: string, input: unknown): PermissionUpdate {
    const ruleContent = toolName === 'Bash'
        ? (getInputStringAny(input, ['command', 'cmd']) ?? undefined)
        : undefined
    return {
        type: 'addRules',
        rules: [{ toolName, ruleContent }],
        behavior: 'allow',
        destination: 'session',
    }
}

/**
 * 格式化权限摘要
 * 优先使用 SDK 提供的 UI 提示字段，回退到从 toolName + input 推断
 */
function formatPermissionSummary(
    permission: ToolPermission,
    toolName: string,
    toolInput: unknown,
    t: (key: string) => string,
    sdkHints?: SDKUIHints
): string {
    if (permission.status === 'pending') {
        // 组合 SDK 提供的 UI 提示字段：displayName + title/description
        const parts: string[] = []
        if (sdkHints?.displayName) parts.push(sdkHints.displayName)
        if (sdkHints?.title && sdkHints.title !== sdkHints.displayName) parts.push(sdkHints.title)
        else if (sdkHints?.description && sdkHints.description !== sdkHints.displayName) parts.push(sdkHints.description)
        const sdkDesc = parts.join(' · ')
        if (sdkDesc) return `${t('chat.tool.waitingForApproval')} ${sdkDesc}`
        // 回退到自行推断
        const desc = getPermissionDescription(toolName, toolInput)
        return desc ? `${t('chat.tool.waitingForApproval')} ${desc}` : t('chat.tool.waitingForApproval')
    }
    if (permission.status === 'canceled') return permission.reason ? `${t('chat.tool.canceled')}: ${permission.reason}` : t('chat.tool.canceled')

    if (permission.status === 'approved') {
        if (permission.mode === 'acceptEdits') return t('chat.tool.approvedAllowAllEdits')
        // 按 approve 时回传的 suggestions destination 显示对应档位文案
        if (permission.suggestions && permission.suggestions.length > 0) {
            const dest = permission.suggestions[0].destination
            if (dest === 'session') return t('chat.tool.approvedForSession')
        }
        return t('chat.tool.approved')
    }

    if (permission.status === 'denied') {
        return permission.reason ? `${t('chat.tool.deny')}: ${permission.reason}` : t('chat.tool.deny')
    }

    return t('chat.tool.allow')
}

/**
 * 工具交互面板标题文本：基于权限状态 + SDK 提示 + 工具输入推断摘要，
 * 去掉「等待审批」前缀（标题区已有图标表意）。供 ToolInteractionPanel 标题区使用。
 */
export function getPermissionDisplayText(
    permission: ToolPermission | null | undefined,
    toolName: string,
    toolInput: unknown,
    t: (key: string) => string,
    sdkHints?: SDKUIHints
): string {
    if (!permission) return ''
    if (permission.status === 'pending') {
        const customKey = getCustomPermissionTitleKey(toolName)
        if (customKey) return t(customKey)
    }
    const summary = formatPermissionSummary(permission, toolName, toolInput, t, sdkHints)
    const prefix = t('chat.tool.waitingForApproval')
    if (summary.startsWith(prefix)) {
        const rest = summary.slice(prefix.length).trim()
        return rest || summary
    }
    return summary
}

type PermissionFooterProps = {
    api: MobiApi
    sessionId: string
    metadata: SessionMetadataSummary | null
    tool: ToolInfo
    disabled: boolean
    onDone: () => void
}

type ActionConfig = {
    label: string
    onClick: () => void
    loading: boolean
    disabled: boolean
}

function PermissionFooterInner(props: PermissionFooterProps) {
    const { t } = useTranslation()
    const { token } = useToken()
    const queryClient = useQueryClient()
    const isDark = useUiStore((s) => resolveTheme(s.theme) === 'dark')
    const isMobile = useIsMobile()
    const permission = props.tool.permission
    // 收敛三个互斥 loading 为单一 pendingAction：'allow' | 'deny' | 'allowAllEdits' | PermissionUpdate[]（选中档的引用）
    const [pendingAction, setPendingAction] = useState<'allow' | 'deny' | 'allowAllEdits' | PermissionUpdate[] | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [showFeedback, setShowFeedback] = useState(false)
    const [feedback, setFeedback] = useState('')
    // 移动端触摸目标 ≥44px；PC 紧凑 32px（避免大按钮突兀）
    const actionMinHeight = isMobile ? 44 : 32

    const toolName = props.tool.name
    // 从 sdkHints 获取 agent 信息（CLI 端在 task_started 时注入）
    const sdkAgentDesc = props.tool.sdkHints?.agentDescription
    const sdkAgentType = props.tool.sdkHints?.agentSubagentType
    const agentInfo = props.tool.sdkHints?.agentID && (sdkAgentDesc || sdkAgentType) ? {
        description: sdkAgentDesc,
        subagentType: sdkAgentType,
    } : null
    const isEditTool = toolName === 'Edit' || toolName === 'MultiEdit' || toolName === 'Write' || toolName === 'NotebookEdit'
    const isExitPlanMode = isExitPlanModeTool(toolName)

    const isPending = permission?.status === 'pending'
    // SDK 无 suggestion 时的 fallback（session 档，命令字面/工具名），用 useMemo 稳定引用
    const fallbackUpdate = useMemo(
        () => buildFallbackUpdate(toolName, props.tool.input),
        [toolName, props.tool.input]
    )
    // SDK suggestions 驱动的持久化档位（Edit/ExitPlanMode 不走 suggestion 档，保留各自路径）
    // useMemo 稳定 items 引用：setPendingAction(items) 存引用，loading 用 pendingAction === items 判定，
    // 若每次 render 重建数组会导致引用不等、loading 永不显示
    // SDK 给 0 suggestion 时，构造 session 档 fallback，让 CLI mobi Set 兜底链路接通（用户选「本次会话允许」→ 回传 → CLI 填 Set）
    const suggestionGroups = useMemo(() => {
        if (!isPending || isEditTool || isExitPlanMode) return []
        const groups = groupSuggestionsByDestination(permission?.suggestions)
        if (groups.length === 0) {
            return [{ destination: 'session' as const, items: [fallbackUpdate] }]
        }
        return groups
    }, [isPending, isEditTool, isExitPlanMode, permission?.suggestions, fallbackUpdate])
    const canAllowAllEdits = isPending && isEditTool

    if (!permission) return null

    // 非等待状态只显示摘要
    if (!isPending) {
        if (permission.status !== 'denied' && permission.status !== 'canceled') return null
        if (!permission.reason) return null

        return (
            <div style={{ marginTop: 8, fontSize: 12, color: token.colorError }}>
                {permission.reason}
            </div>
        )
    }

    const busy = pendingAction !== null
    const disabledAll = props.disabled || busy

    const run = async (action: () => Promise<unknown>) => {
        if (props.disabled) return
        setError(null)
        let handled = true // true = 正常完成或已被处理；false = 需提示错误
        try {
            await action()
        } catch (e) {
            // hub 对「会话仍存活但 requestId 已被处理」返回 404 + code:'permission_request_gone'
            // （典型：首次 approve 成功但 SSE 滞后致卡片残留，用户重复点击）。此情形静默收起，不报错；
            // 其余 404（会话被删 / 路由错误等）仍当真实失败提示，避免掩盖问题。
            const data = (isAxiosError(e) ? (e.response?.data as { code?: string; error?: string } | undefined) : undefined)
            const isHandled = isAxiosError(e)
                && e.response?.status === 404
                && (data?.code === 'permission_request_gone' || data?.error === 'Request not found')
            if (!isHandled) {
                setError(e instanceof Error ? e.message : t('chat.tool.requestFailed'))
                handled = false
            }
        }
        if (!handled) return
        // approve/deny 成功（或 404 已处理）：失效 session 强制重拉最新 agentState，
        // UI 立即移除 permission，不依赖 SSE session-updated 到达。
        // 对齐 AskUserQuestionFooter / RequestUserInputFooter，补齐此前遗漏的失效
        queryClient.invalidateQueries({ queryKey: queryKeys.session(props.sessionId) })
        props.onDone()
    }

    // 「允许本次」：不写 updatedPermissions，SDK 下次同工具仍会调 canCallTool
    const approveOnce = async () => {
        if (busy) return
        setPendingAction('allow')
        await run(() => props.api.permissions.approve(props.sessionId, permission.id))
        setPendingAction(null)
    }

    // 「本次会话/当前项目/当前用户允许」：回传选中档的 suggestions 作 updatedPermissions，SDK 按 destination 持久化放行
    const approveWithPermissions = async (items: PermissionUpdate[]) => {
        if (busy) return
        setPendingAction(items)
        await run(() => props.api.permissions.approve(props.sessionId, permission.id, { updatedPermissions: items }))
        setPendingAction(null)
    }

    // ExitPlanMode 专用：批准并切换权限模式（保留原 setPermissionMode 兜底）
    const approveWithMode = async (mode: 'acceptEdits' | 'default' | 'auto') => {
        if (busy) return
        setPendingAction('allow')
        await run(async () => {
            await props.api.permissions.approve(props.sessionId, permission.id, { mode })
            await props.api.sessions.setPermissionMode(props.sessionId, mode).catch(() => {})
        })
        setPendingAction(null)
    }

    // Edit 工具「全部允许」：切 acceptEdits 模式
    const approveAllEdits = async () => {
        if (!canAllowAllEdits || busy) return
        setPendingAction('allowAllEdits')
        await run(() => props.api.permissions.approve(props.sessionId, permission.id, { mode: 'acceptEdits' }))
        setPendingAction(null)
    }

    const deny = async () => {
        if (busy) return
        setPendingAction('deny')
        await run(() => props.api.permissions.deny(props.sessionId, permission.id))
        setPendingAction(null)
    }

    const denyWithFeedback = async () => {
        if (busy) return
        setPendingAction('deny')
        await run(() => props.api.permissions.deny(props.sessionId, permission.id, {
            reason: feedback.trim() || undefined
        }))
        setPendingAction(null)
    }

    // 主操作：最窄 suggestion 档（primary 满宽）；无 suggestion 档时退化为「允许本次」
    const primaryAction: ActionConfig = suggestionGroups.length > 0
        ? {
            label: t(DESTINATION_LABEL_KEY[suggestionGroups[0].destination]),
            onClick: () => approveWithPermissions(suggestionGroups[0].items),
            loading: pendingAction === suggestionGroups[0].items,
            disabled: disabledAll,
        }
        : { label: t('chat.tool.allow'), onClick: approveOnce, loading: pendingAction === 'allow', disabled: disabledAll }

    // 次操作行：其余 suggestion 档（更宽）+ 「允许本次」（仅当有 suggestion 档时降级）+ Edit 的「全部允许」
    const secondaryActions: ActionConfig[] = [
        ...suggestionGroups.slice(1).map((g) => ({
            label: t(DESTINATION_LABEL_KEY[g.destination]),
            onClick: () => approveWithPermissions(g.items),
            loading: pendingAction === g.items,
            disabled: disabledAll,
        })),
        ...(suggestionGroups.length > 0 ? [{
            label: t('chat.tool.allow'),
            onClick: approveOnce,
            loading: pendingAction === 'allow',
            disabled: disabledAll,
        }] : []),
        ...(canAllowAllEdits ? [{
            label: t('chat.tool.allowAll'),
            onClick: approveAllEdits,
            loading: pendingAction === 'allowAllEdits',
            disabled: disabledAll,
        }] : []),
    ]

    const denyConfig: ActionConfig = {
        label: t('chat.tool.deny'),
        onClick: deny,
        loading: pendingAction === 'deny',
        disabled: disabledAll,
    }

    return (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div id="perm-collapse-actions">
                    {/* Agent 来源标识 */}
                    {agentInfo ? (
                        <div
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                                padding: '4px 8px',
                                borderRadius: 6,
                                background: agentCardBg(
                                    agentInfo.description ?? agentInfo.subagentType ?? 'Agent',
                                    isDark,
                                ),
                                fontSize: 11,
                                color: token.colorTextTertiary,
                            }}
                        >
                            <span style={{ opacity: 0.7 }}>Agent:</span>
                            <span
                                style={{
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                }}
                            >
                                {agentInfo.description ?? agentInfo.subagentType ?? 'Agent'}
                            </span>
                        </div>
                    ) : null}

                    {/* 错误提示：以 Alert 形式呈现，role=alert 便于无障碍 + 测试 */}
                    {error ? (
                        <Alert
                            type="error"
                            showIcon
                            message={error}
                            style={{ fontSize: 12, padding: '8px 12px' }}
                        />
                    ) : null}

                    {/* PC 端不可逆操作提示（移动端在 actions 内用分隔线承载） */}
                    {!isExitPlanMode && !isMobile ? (
                        <div style={{ fontSize: 11, color: token.colorTextTertiary }}>
                            {t('chat.tool.irreversibleHint')}
                        </div>
                    ) : null}

                    {/* 操作组：移动垂直 block（触控友好）/ PC 水平 inline（紧凑）。
                        PC 拒绝提级为 default ghost 与允许同行对等，不再缩到角落 text 弱化；
                        移动保持末行 text 弱化 + 分隔线防误触 */}
                    <div data-group="actions" style={{
                        display: 'flex',
                        flexDirection: isMobile ? 'column' : 'row',
                        gap: 8,
                        alignItems: isMobile ? 'stretch' : 'center',
                        flexWrap: 'wrap',
                    }}>
                        {isExitPlanMode ? (
                            <>
                                <Button
                                    type="primary"
                                    block={isMobile}
                                    icon={<CheckOutlined />}
                                    disabled={disabledAll}
                                    loading={pendingAction === 'allow'}
                                    onClick={() => approveWithMode('auto')}
                                    style={{ minHeight: actionMinHeight, justifyContent: 'center' }}
                                >
                                    {t('chat.tool.approveAuto')}
                                </Button>
                                <Button
                                    block={isMobile}
                                    icon={<CheckOutlined />}
                                    disabled={disabledAll}
                                    loading={pendingAction === 'allow'}
                                    onClick={() => approveWithMode('acceptEdits')}
                                    style={{ minHeight: actionMinHeight, justifyContent: 'center' }}
                                >
                                    {t('chat.tool.approveAutoAccept')}
                                </Button>
                                <Button
                                    block={isMobile}
                                    icon={<CheckOutlined />}
                                    disabled={disabledAll}
                                    loading={pendingAction === 'allow'}
                                    onClick={() => approveWithMode('default')}
                                    style={{ minHeight: actionMinHeight, justifyContent: 'center' }}
                                >
                                    {t('chat.tool.approveManual')}
                                </Button>
                                <Button
                                    type={isMobile ? 'text' : 'default'}
                                    icon={<CloseOutlined />}
                                    disabled={disabledAll}
                                    loading={pendingAction === 'deny'}
                                    onClick={() => {
                                        if (!showFeedback) setShowFeedback(true)
                                    }}
                                    style={{ minHeight: actionMinHeight, justifyContent: 'center', color: isMobile ? token.colorTextSecondary : undefined }}
                                >
                                    {t('chat.tool.keepPlanning')}
                                </Button>
                            </>
                        ) : (
                            <>
                                {/* 主操作行：移动端满宽独占；PC 序列首位 */}
                                <Button
                                    type="primary"
                                    block={isMobile}
                                    icon={<CheckOutlined />}
                                    disabled={primaryAction.disabled}
                                    loading={primaryAction.loading}
                                    onClick={primaryAction.onClick}
                                    style={{ minHeight: actionMinHeight, justifyContent: 'center' }}
                                >
                                    {primaryAction.label}
                                </Button>
                                {/* 次要行：其余持久化档 + 允许本次 + 全部允许（default）+ 拒绝（text+danger 警示）
                                    移动端 flex:1 等分并排；PC 作为一组 inline 续在主操作后 */}
                                <div data-sub-row="secondary" style={{
                                    display: 'flex',
                                    flexDirection: 'row',
                                    gap: 8,
                                    alignItems: 'stretch',
                                }}>
                                    {secondaryActions.map((action, idx) => (
                                        <Button
                                            key={idx}
                                            icon={<CheckOutlined />}
                                            disabled={action.disabled}
                                            loading={action.loading}
                                            onClick={action.onClick}
                                            style={{ minHeight: actionMinHeight, flex: isMobile ? 1 : undefined, justifyContent: 'center' }}
                                        >
                                            {action.label}
                                        </Button>
                                    ))}
                                    <Button
                                        type="text"
                                        danger
                                        icon={<CloseOutlined />}
                                        disabled={denyConfig.disabled}
                                        loading={denyConfig.loading}
                                        onClick={denyConfig.onClick}
                                        style={{ minHeight: actionMinHeight, flex: isMobile ? 1 : undefined, justifyContent: 'center' }}
                                    >
                                        {denyConfig.label}
                                    </Button>
                                    {/* 「带原因拒绝」：展开 textarea 走 denyWithFeedback（对齐 CLI reject-with-feedback） */}
                                    <Button
                                        type="text"
                                        disabled={disabledAll}
                                        onClick={() => setShowFeedback(true)}
                                        style={{ minHeight: actionMinHeight, flex: isMobile ? 1 : undefined, justifyContent: 'center', color: token.colorTextSecondary }}
                                    >
                                        {t('chat.tool.denyWithReason')}
                                    </Button>
                                </div>
                                {/* 分隔线 + 不可逆提示：仅移动端（PC 端上方已有文字提示） */}
                                {isMobile ? (
                                    <div style={{
                                        display: 'flex', alignItems: 'center', gap: 8,
                                        margin: '4px 0', width: '100%',
                                        color: token.colorTextQuaternary, fontSize: 11,
                                    }}>
                                        <span style={{ flex: 1, height: 1, background: token.colorBorderSecondary }} />
                                        <span>{t('chat.tool.irreversibleHint')}</span>
                                        <span style={{ flex: 1, height: 1, background: token.colorBorderSecondary }} />
                                    </div>
                                ) : null}
                            </>
                        )}
                    </div>

                    {/* 拒绝反馈输入区（普通工具 + ExitPlanMode 共用） */}
                    {showFeedback ? (
                        <div>
                            <Input.TextArea
                                value={feedback}
                                onChange={(e) => setFeedback(e.target.value)}
                                placeholder={isExitPlanMode
                                    ? t('chat.tool.keepPlanningPlaceholder')
                                    : t('chat.tool.denyReasonPlaceholder')}
                                rows={3}
                                status="error"
                                style={{ fontSize: 12 }}
                                autoFocus
                            />
                            <Button
                                size="small"
                                danger
                                style={{ marginTop: 4 }}
                                onClick={denyWithFeedback}
                                loading={pendingAction === 'deny'}
                                disabled={disabledAll}
                            >
                                {t('chat.tool.sendFeedback')}
                            </Button>
                        </div>
                    ) : null}
                </div>
        </div>
    )
}

export const PermissionFooter = memo(PermissionFooterInner)
