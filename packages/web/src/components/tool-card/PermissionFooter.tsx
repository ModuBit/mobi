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
import { memo, useMemo, useState } from 'react'
import { Button, theme as antTheme, Typography, Spin } from 'antd'
import { CheckOutlined, CloseOutlined, StopOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { getInputStringAny } from '@/core/lib/toolInputUtils'

const { Text } = Typography
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
 */
function formatPermissionSummary(
    permission: ToolPermission,
    toolName: string,
    toolInput: unknown,
    t: (key: string) => string
): string {
    if (permission.status === 'pending') return t('tool.waitingForApproval')
    if (permission.status === 'canceled') return permission.reason ? `${t('tool.canceled')}: ${permission.reason}` : t('tool.canceled')

    if (permission.status === 'approved') {
        if (permission.mode === 'acceptEdits') return t('tool.approvedAllowAllEdits')
        if (isToolAllowedForSession(toolName, toolInput, permission.allowedTools)) return t('tool.approvedForSession')
        return t('tool.approved')
    }

    if (permission.status === 'denied') {
        return permission.reason ? `${t('tool.deny')}: ${permission.reason}` : t('tool.deny')
    }

    return t('tool.allow')
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
    const permission = props.tool.permission
    const [loading, setLoading] = useState<'allow' | 'deny' | null>(null)
    const [loadingForSession, setLoadingForSession] = useState(false)
    const [loadingAllEdits, setLoadingAllEdits] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const toolName = props.tool.name
    const isEditTool = toolName === 'Edit' || toolName === 'MultiEdit' || toolName === 'Write' || toolName === 'NotebookEdit'
    const hideAllowForSession = isEditTool || toolName === 'exit_plan_mode' || toolName === 'ExitPlanMode'

    const isPending = permission?.status === 'pending'
    const canAllowForSession = isPending && !hideAllowForSession
    const canAllowAllEdits = isPending && isEditTool

    const summary = useMemo(() => {
        if (!permission) return ''
        return formatPermissionSummary(permission, toolName, props.tool.input, t)
    }, [permission, toolName, props.tool.input, t])

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
            setError(e instanceof Error ? e.message : t('tool.requestFailed'))
        }
    }

    const approve = async () => {
        if (!isPending || loading || loadingAllEdits || loadingForSession) return
        setLoading('allow')
        await run(() => props.api.permissions.approve(props.sessionId, permission.id))
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

    return (
        <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 12, color: token.colorTextSecondary }}>{summary}</div>

            {error ? (
                <div style={{ marginTop: 8, fontSize: 12, color: token.colorError }}>
                    {error}
                </div>
            ) : null}

            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <Button
                    type="primary"
                    size="small"
                    icon={loading === 'allow' ? <Spin size="small" /> : <CheckOutlined />}
                    disabled={props.disabled || loading !== null || loadingAllEdits || loadingForSession}
                    loading={loading === 'allow'}
                    onClick={approve}
                    style={{ justifyContent: 'flex-start' }}
                >
                    {t('tool.allow')}
                </Button>

                {canAllowForSession ? (
                    <Button
                        size="small"
                        icon={loadingForSession ? <Spin size="small" /> : null}
                        disabled={props.disabled || loading !== null || loadingAllEdits || loadingForSession}
                        loading={loadingForSession}
                        onClick={approveForSession}
                        style={{ justifyContent: 'flex-start' }}
                    >
                        {t('tool.allowForSession')}
                    </Button>
                ) : null}

                {canAllowAllEdits ? (
                    <Button
                        size="small"
                        icon={loadingAllEdits ? <Spin size="small" /> : null}
                        disabled={props.disabled || loading !== null || loadingAllEdits || loadingForSession}
                        loading={loadingAllEdits}
                        onClick={approveAllEdits}
                        style={{ justifyContent: 'flex-start' }}
                    >
                        {t('tool.allowAll')}
                    </Button>
                ) : null}

                <Button
                    size="small"
                    danger
                    icon={loading === 'deny' ? <Spin size="small" /> : <CloseOutlined />}
                    disabled={props.disabled || loading !== null || loadingAllEdits || loadingForSession}
                    loading={loading === 'deny'}
                    onClick={deny}
                    style={{ justifyContent: 'flex-start' }}
                >
                    {t('tool.deny')}
                </Button>
            </div>
        </div>
    )
}

export const PermissionFooter = memo(PermissionFooterInner)
