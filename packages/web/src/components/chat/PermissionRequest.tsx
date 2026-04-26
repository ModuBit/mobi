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
 * 权限请求组件
 * 在主对话框中展示所有 pending 权限请求（包括 subagent 的）
 * 与 PermissionFooter 配合使用：PermissionFooter 跟随工具 bubble，PermissionRequest 处理全局权限请求
 */

import { useMemo } from 'react'
import { Typography, theme as antTheme } from 'antd'
import { useTranslation } from 'react-i18next'
import { ExclamationCircleOutlined } from '@ant-design/icons'
import type { Session, SessionMetadataSummary } from '@/core/data/api/types'
import type { MobiApi } from '@/core/data/api/client'
import { PermissionFooter } from '@/components/tool-card/PermissionFooter'

const { Text } = Typography
const { useToken } = antTheme

interface PermissionRequestProps {
    sessionId: string
    session: Session | null | undefined
    metadata: SessionMetadataSummary | null
    api: MobiApi
    disabled?: boolean
    onDone?: () => void
}

export function PermissionRequest({ sessionId, session, metadata, api, disabled, onDone }: PermissionRequestProps) {
    const { token } = useToken()
    const { t } = useTranslation()

    const requests = session?.agentState?.requests || {}
    const pendingRequests = Object.entries(requests)

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
                }
            }
        })
    }, [pendingRequests])

    if (pendingRequests.length === 0) return null

    return (
        <div style={{ margin: '8px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {permissionTools.map(({ id, tool }) => (
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
                            {tool.name}
                        </Text>
                    </div>
                    <PermissionFooter
                        api={api}
                        sessionId={sessionId}
                        metadata={metadata}
                        tool={tool}
                        disabled={disabled ?? false}
                        onDone={onDone ?? (() => {})}
                    />
                </div>
            ))}
        </div>
    )
}
