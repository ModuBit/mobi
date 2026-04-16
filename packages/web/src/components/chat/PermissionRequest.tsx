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

import { Button, Space, Typography, Tag, theme as antTheme } from 'antd'
import { useTranslation } from 'react-i18next'
import { ExclamationCircleOutlined } from '@ant-design/icons'
import type { Session } from '@/api/types'
import { useAuthStore } from '@/stores/authStore'
import { useMobiApi } from '@/api/client'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query-keys'

const { Text } = Typography
const { useToken } = antTheme

interface PermissionRequestProps {
    sessionId: string
    session: Session | null | undefined
}

export function PermissionRequest({ sessionId, session }: PermissionRequestProps) {
    const { token: authToken } = useAuthStore()
    const api = useMobiApi(authToken)
    const queryClient = useQueryClient()
    const { token } = useToken()
    const { t } = useTranslation()

    const requests = session?.agentState?.requests || {}
    const pendingRequests = Object.entries(requests)

    const approveMutation = useMutation({
        mutationFn: (requestId: string) => api.permissions.approve(sessionId, requestId),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: queryKeys.session(sessionId) })
        }
    })

    const denyMutation = useMutation({
        mutationFn: (requestId: string) => api.permissions.deny(sessionId, requestId),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: queryKeys.session(sessionId) })
        }
    })

    if (pendingRequests.length === 0) return null

    return (
        <div style={{ margin: '8px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {pendingRequests.map(([requestId, request]) => {
                const toolName = (request as { tool?: string })?.tool || 'Unknown'
                return (
                    <div key={requestId} style={{
                        padding: 12,
                        background: token.colorWarningBg,
                        border: `1px solid ${token.colorWarningBorder}`,
                        borderRadius: 8
                    }}>
                        <Space orientation="vertical" style={{ width: '100%' }}>
                            <Text strong>
                                <ExclamationCircleOutlined style={{ color: token.colorWarningText, marginRight: 8 }} />
                                {t('chat.permission.title')}
                            </Text>
                            <Text>
                                {t('chat.permission.toolRequest', { tool: toolName })} <Tag color="orange">{toolName}</Tag>
                            </Text>
                            <Space>
                                <Button
                                    type="primary"
                                    size="small"
                                    onClick={() => approveMutation.mutate(requestId)}
                                    loading={approveMutation.isPending}
                                >
                                    {t('common.approve')}
                                </Button>
                                <Button
                                    danger
                                    size="small"
                                    onClick={() => denyMutation.mutate(requestId)}
                                    loading={denyMutation.isPending}
                                >
                                    {t('common.reject')}
                                </Button>
                            </Space>
                        </Space>
                    </div>
                )
            })}
        </div>
    )
}
