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

import { Button, Space, Typography, Tag } from 'antd'
import { ExclamationCircleOutlined } from '@ant-design/icons'
import type { Session } from '@/api/types'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/authStore'
import { createMobiApi } from '@/api/client'

const { Text } = Typography

interface PermissionRequestProps {
    sessionId: string
    session: Session | null | undefined
}

export function PermissionRequest({ sessionId, session }: PermissionRequestProps) {
    const { token } = useAuthStore()
    const api = createMobiApi(token)
    const queryClient = useQueryClient()

    const requests = session?.agentState?.requests || {}
    const pendingRequests = Object.entries(requests)

    const approveMutation = useMutation({
        mutationFn: (requestId: string) => api.permissions.approve(sessionId, requestId),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['session', sessionId] })
        }
    })

    const denyMutation = useMutation({
        mutationFn: (requestId: string) => api.permissions.deny(sessionId, requestId),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['session', sessionId] })
        }
    })

    if (pendingRequests.length === 0) return null

    const [requestId, request] = pendingRequests[0]
    const toolName = (request as { tool?: string })?.tool || 'Unknown'

    return (
        <div style={{
            margin: '8px 16px',
            padding: 12,
            background: '#fffbe6',
            border: '1px solid #ffe58f',
            borderRadius: 8
        }}>
            <Space direction="vertical" style={{ width: '100%' }}>
                <Space>
                    <ExclamationCircleOutlined style={{ color: '#faad14' }} />
                    <Text strong>需要权限确认</Text>
                </Space>
                <Text>
                    工具 <Tag color="orange">{toolName}</Tag> 请求执行权限
                </Text>
                <Space>
                    <Button
                        type="primary"
                        size="small"
                        onClick={() => approveMutation.mutate(requestId)}
                        loading={approveMutation.isPending}
                    >
                        批准
                    </Button>
                    <Button
                        danger
                        size="small"
                        onClick={() => denyMutation.mutate(requestId)}
                        loading={denyMutation.isPending}
                    >
                        拒绝
                    </Button>
                </Space>
            </Space>
        </div>
    )
}
