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
import type { SDKUIHints } from '@mobi/shared'
import { memo, useState } from 'react'
import { Alert, Button, Input, theme as antTheme } from 'antd'
import { CheckOutlined, CloseOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { agentCardBg } from '@/components/composer/agentPalette'
import { useUiStore, resolveTheme } from '@/core/data/stores/uiStore'
import { useIsMobile } from '@/core/data/hooks/useMediaQuery'
import { getInputStringAny, getCustomPermissionTitleKey, getPermissionDescription, isExitPlanModeTool } from '@/core/lib/toolInputUtils'

const { useToken } = antTheme

/**
 * 检查工具是否允许在会话中使用
 */
function isToolAllowedForSession(toolName: string, toolInput: unknown, allowedTools: string[] | undefined): boolean {
    if (!allowedTools || allowedTools.length === 0) return false
    if (allowedTools.includes(toolName)) return true

    if (toolName === 'Bash') {
        const command = getInputStringAny(toolInput, ['command', 'cmd'])
        if (command) {
            return allowedTools.includes(`Bash(${command})`)
        }
    }

    return false
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
        if (isToolAllowedForSession(toolName, toolInput, permission.allowedTools)) return t('chat.tool.approvedForSession')
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

function PermissionFooterInner(props: PermissionFooterProps) {
    const { t } = useTranslation()
    const { token } = useToken()
    const isDark = useUiStore((s) => resolveTheme(s.theme) === 'dark')
    const isMobile = useIsMobile()
    const permission = props.tool.permission
    const [loading, setLoading] = useState<'allow' | 'deny' | null>(null)
    const [loadingForSession, setLoadingForSession] = useState(false)
    const [loadingAllEdits, setLoadingAllEdits] = useState(false)
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
    const hideAllowForSession = isEditTool || isExitPlanMode

    const isPending = permission?.status === 'pending'
    const canAllowForSession = isPending && !hideAllowForSession
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

    const run = async (action: () => Promise<unknown>) => {
        if (props.disabled) return
        setError(null)
        try {
            await action()
            props.onDone()
        } catch (e) {
            setError(e instanceof Error ? e.message : t('chat.tool.requestFailed'))
        }
    }

    const approve = async () => {
        if (!isPending || loading || loadingAllEdits || loadingForSession) return
        setLoading('allow')
        await run(() => props.api.permissions.approve(props.sessionId, permission.id))
        setLoading(null)
    }

    const approveWithMode = async (mode: 'acceptEdits' | 'default') => {
        if (!isPending || loading || loadingAllEdits || loadingForSession) return
        setLoading('allow')
        await run(async () => {
            await props.api.permissions.approve(props.sessionId, permission.id, { mode })
            await props.api.sessions.setPermissionMode(props.sessionId, mode).catch(() => {})
        })
        setLoading(null)
    }

    const approveAllEdits = async () => {
        if (!isPending || !canAllowAllEdits || loading || loadingAllEdits || loadingForSession) return
        setLoadingAllEdits(true)
        // 传递 mode: 'acceptEdits' 参数，切换到 acceptEdits 模式
        await run(() => props.api.permissions.approve(props.sessionId, permission.id, { mode: 'acceptEdits' }))
        setLoadingAllEdits(false)
    }

    const approveForSession = async () => {
        if (!isPending || !canAllowForSession || loading || loadingAllEdits || loadingForSession) return
        setLoadingForSession(true)
        const command = toolName === 'Bash' ? getInputStringAny(props.tool.input, ['command', 'cmd']) : null
        const toolIdentifier = toolName === 'Bash' && command ? `Bash(${command})` : toolName
        // 传递 allowTools 参数，让 CLI 在会话内自动允许该工具
        await run(() => props.api.permissions.approve(props.sessionId, permission.id, { allowTools: [toolIdentifier] }))
        setLoadingForSession(false)
    }

    const deny = async () => {
        if (!isPending || loading || loadingAllEdits || loadingForSession) return
        setLoading('deny')
        await run(() => props.api.permissions.deny(props.sessionId, permission.id))
        setLoading(null)
    }

    const denyWithFeedback = async () => {
        if (!isPending || loading || loadingAllEdits || loadingForSession) return
        setLoading('deny')
        await run(() => props.api.permissions.deny(props.sessionId, permission.id, {
            reason: feedback.trim() || undefined
        }))
        setLoading(null)
    }

    // 主操作与次操作配置：按工具类型决定视觉层级
    // 实际最常用「本次会话允许」→ 非 Edit 工具提为主操作（primary 满宽），允许降为 default 次操作
    // Edit 工具无「本次会话允许」：允许保持 primary，「全部允许」(=切 acceptEdits，更激进) 保持次级，避免误开激进模式
    // 拒绝：text + danger 警示色文字 —— 语义层红字提示，但非 primary 不抢视觉锚点
    const disabledAll = props.disabled || loading !== null || loadingAllEdits || loadingForSession
    const denyConfig = {
        label: t('chat.tool.deny'),
        onClick: deny,
        loading: loading === 'deny',
        disabled: disabledAll,
    }
    const primaryAction = canAllowForSession
        ? { label: t('chat.tool.allowForSession'), onClick: approveForSession, loading: loadingForSession, disabled: disabledAll }
        : { label: t('chat.tool.allow'), onClick: approve, loading: loading === 'allow', disabled: disabledAll }
    const secondaryAction = canAllowForSession
        ? { label: t('chat.tool.allow'), onClick: approve, loading: loading === 'allow', disabled: disabledAll }
        : canAllowAllEdits
            ? { label: t('chat.tool.allowAll'), onClick: approveAllEdits, loading: loadingAllEdits, disabled: disabledAll }
            : null

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
                                    disabled={props.disabled || loading !== null}
                                    loading={loading === 'allow'}
                                    onClick={() => approveWithMode('acceptEdits')}
                                    style={{ minHeight: actionMinHeight, justifyContent: 'center' }}
                                >
                                    {t('chat.tool.approveAutoAccept')}
                                </Button>
                                <Button
                                    block={isMobile}
                                    icon={<CheckOutlined />}
                                    disabled={props.disabled || loading !== null}
                                    loading={loading === 'allow'}
                                    onClick={() => approveWithMode('default')}
                                    style={{ minHeight: actionMinHeight, justifyContent: 'center' }}
                                >
                                    {t('chat.tool.approveManual')}
                                </Button>
                                <Button
                                    type={isMobile ? 'text' : 'default'}
                                    icon={<CloseOutlined />}
                                    disabled={props.disabled || loading !== null}
                                    loading={loading === 'deny'}
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
                                {/* 次要行：允许/全部允许（default）+ 拒绝（text+danger 警示）
                                    移动端 flex:1 等分并排；PC 作为一组 inline 续在主操作后 */}
                                <div data-sub-row="secondary" style={{
                                    display: 'flex',
                                    flexDirection: 'row',
                                    gap: 8,
                                    alignItems: 'stretch',
                                    flex: isMobile ? undefined : undefined,
                                }}>
                                    {secondaryAction ? (
                                        <Button
                                            icon={<CheckOutlined />}
                                            disabled={secondaryAction.disabled}
                                            loading={secondaryAction.loading}
                                            onClick={secondaryAction.onClick}
                                            style={{ minHeight: actionMinHeight, flex: isMobile ? 1 : undefined, justifyContent: 'center' }}
                                        >
                                            {secondaryAction.label}
                                        </Button>
                                    ) : null}
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

                    {/* 继续规划反馈输入区（仅 exitPlanMode） */}
                    {showFeedback && isExitPlanMode ? (
                        <div>
                            <Input.TextArea
                                value={feedback}
                                onChange={(e) => setFeedback(e.target.value)}
                                placeholder={t('chat.tool.keepPlanningPlaceholder')}
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
                                loading={loading === 'deny'}
                                disabled={props.disabled || loading !== null}
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
