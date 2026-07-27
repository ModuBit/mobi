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
import { memo, useMemo, useState } from 'react'
import { Alert, Button, Input, Spin, theme as antTheme } from 'antd'
import { CheckOutlined, CloseOutlined } from '@ant-design/icons'
import { ChevronDown } from 'lucide-react'
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
    // 无障碍：尊重用户的减少动画偏好（与 PixelCard.tsx 一致的一次性探测）
    const reducedMotion = typeof window !== 'undefined' && window.matchMedia
        ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
        : false
    const permission = props.tool.permission
    const [loading, setLoading] = useState<'allow' | 'deny' | null>(null)
    const [loadingForSession, setLoadingForSession] = useState(false)
    const [loadingAllEdits, setLoadingAllEdits] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [showFeedback, setShowFeedback] = useState(false)
    const [feedback, setFeedback] = useState('')
    // 折叠态：默认展开。移动端可折叠以省空间，避免误触
    const [collapsed, setCollapsed] = useState(false)
    // 移动端触摸目标 ≥44px，桌面端 40px
    const actionMinHeight = isMobile ? 44 : 40

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

    const customTitleKey = useMemo(() => getCustomPermissionTitleKey(toolName), [toolName])
    const summary = useMemo(() => {
        if (!permission) return ''
        if (isPending && customTitleKey) return t(customTitleKey)
        return formatPermissionSummary(permission, toolName, props.tool.input, t, props.tool.sdkHints)
    }, [permission, toolName, props.tool.input, t, props.tool.sdkHints, isPending, customTitleKey])

    // pending 时折叠头已有"等待审批"徽标，summary 文本不再重复该前缀，
    // 仅展示工具身份/命令摘要（与 tool-card/index.tsx 顶部 pending-badge 去重）
    // 注意：本 memo 仅在 pending 渲染路径下被消费（非 pending 在上方已 early-return），
    // 故无需再处理非 pending 分支
    const summaryDisplay = useMemo(() => {
        const prefix = t('chat.tool.waitingForApproval')
        if (summary.startsWith(prefix)) {
            const rest = summary.slice(prefix.length).trim()
            return rest || summary
        }
        return summary
    }, [summary, t])

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

    return (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {/* 折叠头：徽标 + 工具摘要 + 展开箭头（button 以提供键盘可达性） */}
            <button
                type="button"
                data-testid="perm-collapse-toggle"
                aria-expanded={!collapsed}
                aria-controls="perm-collapse-actions"
                onClick={() => setCollapsed((c) => !c)}
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    width: '100%',
                    minHeight: actionMinHeight,
                    cursor: 'pointer',
                    color: token.colorTextSecondary,
                    fontSize: 13,
                    background: 'transparent',
                    border: 'none',
                    padding: 0,
                    textAlign: 'left',
                }}
            >
                <span
                    style={{
                        fontSize: 11,
                        color: token.colorPrimary,
                        background: token.colorPrimaryBg,
                        border: `1px solid ${token.colorPrimaryBorder}`,
                        padding: '1px 8px',
                        borderRadius: 10,
                        flexShrink: 0,
                    }}
                >
                    {t('chat.tool.waitingForApproval')}
                </span>
                <span
                    style={{
                        flex: 1,
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                    }}
                >
                    {summaryDisplay}
                </span>
                <span
                    style={{
                        transform: collapsed ? 'none' : 'rotate(180deg)',
                        transition: reducedMotion ? 'none' : 'transform .2s',
                        color: token.colorTextTertiary,
                        flexShrink: 0,
                    }}
                >
                    <ChevronDown size={14} />
                </span>
            </button>

            {collapsed ? null : (
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

                    {/* 主操作组：允许 / 本会话允许 / 全部允许 / 自动接受 / 手动审批 */}
                    <div data-group="primary" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {isExitPlanMode ? (
                            <>
                                <Button
                                    type="primary"
                                    block
                                    icon={loading === 'allow' ? <Spin size="small" /> : <CheckOutlined />}
                                    disabled={props.disabled || loading !== null}
                                    loading={loading === 'allow'}
                                    onClick={() => approveWithMode('acceptEdits')}
                                    style={{ minHeight: actionMinHeight, justifyContent: 'center' }}
                                >
                                    {t('chat.tool.approveAutoAccept')}
                                </Button>
                                <Button
                                    block
                                    icon={loading === 'allow' ? <Spin size="small" /> : <CheckOutlined />}
                                    disabled={props.disabled || loading !== null}
                                    loading={loading === 'allow'}
                                    onClick={() => approveWithMode('default')}
                                    style={{ minHeight: actionMinHeight, justifyContent: 'center' }}
                                >
                                    {t('chat.tool.approveManual')}
                                </Button>
                            </>
                        ) : (
                            <>
                                <Button
                                    type="primary"
                                    block
                                    icon={loading === 'allow' ? <Spin size="small" /> : <CheckOutlined />}
                                    disabled={
                                        props.disabled ||
                                        loading !== null ||
                                        loadingAllEdits ||
                                        loadingForSession
                                    }
                                    loading={loading === 'allow'}
                                    onClick={approve}
                                    style={{ minHeight: actionMinHeight, justifyContent: 'center' }}
                                >
                                    {t('chat.tool.allow')}
                                </Button>
                                {canAllowForSession ? (
                                    <Button
                                        block
                                        disabled={
                                            props.disabled ||
                                            loading !== null ||
                                            loadingAllEdits ||
                                            loadingForSession
                                        }
                                        loading={loadingForSession}
                                        onClick={approveForSession}
                                        style={{ minHeight: actionMinHeight, justifyContent: 'center' }}
                                    >
                                        {t('chat.tool.allowForSession')}
                                    </Button>
                                ) : null}
                                {canAllowAllEdits ? (
                                    <Button
                                        block
                                        disabled={
                                            props.disabled ||
                                            loading !== null ||
                                            loadingAllEdits ||
                                            loadingForSession
                                        }
                                        loading={loadingAllEdits}
                                        onClick={approveAllEdits}
                                        style={{ minHeight: actionMinHeight, justifyContent: 'center' }}
                                    >
                                        {t('chat.tool.allowAll')}
                                    </Button>
                                ) : null}
                            </>
                        )}
                    </div>

                    {/* 分隔线：视觉上把主操作与拒绝隔开，降低误触概率 */}
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            margin: '12px 0',
                            color: token.colorTextQuaternary,
                            fontSize: 11,
                        }}
                    >
                        <span style={{ flex: 1, height: 1, background: token.colorBorderSecondary }} />
                        {!isExitPlanMode ? <span>{t('chat.tool.irreversibleHint')}</span> : null}
                        <span style={{ flex: 1, height: 1, background: token.colorBorderSecondary }} />
                    </div>

                    {/* 拒绝组：text 按钮、右对齐、视觉弱化，与主操作物理隔离 */}
                    <div data-group="deny" style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        {isExitPlanMode ? (
                            <Button
                                type="text"
                                icon={loading === 'deny' ? <Spin size="small" /> : <CloseOutlined />}
                                disabled={props.disabled || loading !== null}
                                loading={loading === 'deny'}
                                onClick={() => {
                                    if (!showFeedback) setShowFeedback(true)
                                }}
                                style={{ color: token.colorTextSecondary, minHeight: actionMinHeight }}
                            >
                                {t('chat.tool.keepPlanning')}
                            </Button>
                        ) : (
                            <Button
                                type="text"
                                icon={loading === 'deny' ? <Spin size="small" /> : <CloseOutlined />}
                                disabled={
                                    props.disabled ||
                                    loading !== null ||
                                    loadingAllEdits ||
                                    loadingForSession
                                }
                                loading={loading === 'deny'}
                                onClick={deny}
                                style={{ color: token.colorTextSecondary, minHeight: actionMinHeight }}
                            >
                                {t('chat.tool.deny')}
                            </Button>
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
            )}
        </div>
    )
}

export const PermissionFooter = memo(PermissionFooterInner)
