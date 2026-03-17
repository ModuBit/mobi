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

import { Button, Space, Select, Tag, Typography, theme as antTheme } from 'antd'
import { useTranslation } from 'react-i18next'
import { ArrowLeftOutlined } from '@ant-design/icons'
import { useNavigate } from '@tanstack/react-router'
import type { Session } from '@/api/types'
import { useAuthStore } from '@/stores/authStore'
import { useMobiApi } from '@/api/client'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { getSessionDisplayName } from '@/utils/sessionUtils'

const { Text } = Typography
const { useToken } = antTheme

interface SessionHeaderProps {
    session: Session
}

export function SessionHeader({ session }: SessionHeaderProps) {
    const navigate = useNavigate()
    const { token: authToken } = useAuthStore()
    const api = useMobiApi(authToken)
    const queryClient = useQueryClient()
    const { token } = useToken()
    const { t } = useTranslation()

    const setPermMutation = useMutation({
        mutationFn: (mode: string) => api.sessions.setPermissionMode(session.id, mode),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['session', session.id] })
    })

    const displayName = getSessionDisplayName(session)

    return (
        <div style={{
            padding: '12px 16px',
            borderBottom: `1px solid ${token.colorBorder}`,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: token.colorBgContainer,
            position: 'sticky',
            top: 0,
            zIndex: 10
        }}>
            <Button
                icon={<ArrowLeftOutlined />}
                type="text"
                onClick={() => navigate({ to: '/' })}
            />
            <Text strong ellipsis style={{ flex: 1, minWidth: 0 }}>{displayName}</Text>
            <Space size="small">
                {session.active && (
                    <Tag color={session.thinking ? 'blue' : 'green'}>
                        {session.thinking ? t('session.status.thinking') : t('session.status.active')}
                    </Tag>
                )}
                {!session.active && (
                    <Tag color="default">{t('session.status.ended')}</Tag>
                )}
                <Select
                    value={session.permissionMode || 'default'}
                    size="small"
                    style={{ width: 100 }}
                    onChange={(mode) => setPermMutation.mutate(mode)}
                    options={[
                        { label: 'Default', value: 'default' },
                        { label: 'Auto', value: 'acceptEdits' },
                        { label: 'Yolo', value: 'bypassPermissions' },
                        { label: 'Plan', value: 'plan' },
                    ]}
                />
            </Space>
        </div>
    )
}
