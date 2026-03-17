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

import { Card, Badge, Typography, Space, theme as antTheme } from 'antd'
import { useTranslation } from 'react-i18next'
import type { Session } from '@/api/types'
import { useNavigate } from '@tanstack/react-router'

const { Text } = Typography
const { useToken } = antTheme

interface SessionCardProps {
    session: Session
    active?: boolean
}

export function SessionCard({ session, active }: SessionCardProps) {
    const navigate = useNavigate()
    const { token } = useToken()
    const { t } = useTranslation()
    const metadata = session.metadata as { name?: string; path?: string } | undefined

    const handleClick = () => {
        navigate({ to: '/sessions/$sessionId', params: { sessionId: session.id } })
    }

    const displayName = metadata?.name || metadata?.path?.split('/').pop() || session.id.slice(0, 8)
    const status = session.active ? 'processing' : 'default'
    const statusText = session.active
        ? (session.thinking ? t('session.status.thinking') + '...' : t('session.status.active'))
        : t('session.status.ended')

    return (
        <Card
            hoverable
            onClick={handleClick}
            size="small"
            style={{
                marginBottom: 8,
                cursor: 'pointer',
                border: active ? `2px solid ${token.colorPrimary}` : `1px solid ${token.colorBorder}`
            }}
            styles={{ body: { padding: '12px 16px' } }}
        >
            <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                <Text strong ellipsis style={{ maxWidth: 180 }}>{displayName}</Text>
                <Badge status={status} text={statusText} />
            </Space>
            {metadata?.path && (
                <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }} ellipsis>
                    {metadata.path}
                </Text>
            )}
        </Card>
    )
}
