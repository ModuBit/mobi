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
 * 在 StatusBar 上方展示各种状态信息：权限请求、任务列表、文件修改等
 */

import { useMemo } from 'react'
import { Typography, theme as antTheme } from 'antd'
import { useTranslation } from 'react-i18next'
import { ExclamationCircleOutlined } from '@ant-design/icons'
import type { AgentState, SessionMetadataSummary } from '@/core/data/api/types'
import type { MobiApi } from '@/core/data/api/client'
import { PermissionFooter } from '@/components/tool-card/PermissionFooter'
import { getPermissionDescription } from '@/core/lib/toolInputUtils'

const { Text } = Typography
const { useToken } = antTheme

/** 权限请求面板 */
function PermissionPanel({
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

    const pendingRequests = requests ? Object.entries(requests) : []

    // 转换为 PermissionFooter 需要的格式
    const permissionTools = useMemo(() => {
        return pendingRequests.map(([requestId, request]) => {
            const req = request as { tool?: string; arguments?: unknown; createdAt?: number | null }
            return {
                id: requestId,
                tool: {
                    name: req.tool || 'Unknown',
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
                    }
                },
                description: getPermissionDescription(req.tool || 'Unknown', req.arguments)
            }
        })
    }, [pendingRequests])

    if (pendingRequests.length === 0) return null

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {permissionTools.map(({ id, tool, description }) => (
                <div key={id} style={{
                    padding: 12,
                    background: token.colorWarningBg,
                    border: `1px solid ${token.colorWarningBorder}`,
                    borderRadius: 8
                }}>
                    <div style={{ marginBottom: 8 }}>
                        <Text strong>
                            <ExclamationCircleOutlined style={{ color: token.colorWarningText, marginRight: 8 }} />
                            {t('chat.permission.title')}
                        </Text>
                        <Text type="secondary" style={{ marginLeft: 8 }}>
                            {description || tool.name}
                        </Text>
                    </div>
                    <PermissionFooter
                        api={api}
                        sessionId={sessionId}
                        metadata={metadata}
                        tool={tool}
                        disabled={disabled}
                        onDone={onDone}
                    />
                </div>
            ))}
        </div>
    )
}

export type ComposerInfoPanelProps = {
    sessionId: string
    agentState: AgentState | null | undefined
    metadata: SessionMetadataSummary | null
    api: MobiApi
    disabled: boolean
    onPermissionDone: () => void
}

/**
 * Composer 信息面板
 * 在 StatusBar 上方展示各种状态信息
 */
export function ComposerInfoPanel({
    sessionId,
    agentState,
    metadata,
    api,
    disabled,
    onPermissionDone
}: ComposerInfoPanelProps) {
    const hasContent = agentState?.requests && Object.keys(agentState.requests).length > 0

    if (!hasContent) return null

    return (
        <div style={{ padding: '8px 16px', marginBottom: 4 }}>
            {/* 权限请求 */}
            <PermissionPanel
                requests={agentState?.requests}
                metadata={metadata}
                api={api}
                sessionId={sessionId}
                disabled={disabled}
                onDone={onPermissionDone}
            />

            {/* 未来扩展：任务列表、文件修改等 */}
        </div>
    )
}
