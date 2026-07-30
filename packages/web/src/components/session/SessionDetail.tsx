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

import { Spin, Result, Button } from 'antd'
import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from '@tanstack/react-router'
import { useSession } from '@/core/data/hooks/queries/useSession'
import { useNotificationBadgeStore } from '@/core/data/stores/notificationBadgeStore'
import { ChatPane } from '@/components/session/ChatPane'
import { InspectorPane } from '@/components/session/InspectorPane'
import { WorkspaceSplitter } from '@/components/session/WorkspaceSplitter'
import { getAgentStatus } from '@/components/pixel-avatar/types'
import { getSessionDisplayName } from '@/core/utils/sessionUtils'
import { useWakeLock } from '@/core/pwa/useWakeLock'

interface SessionDetailProps {
    sessionId: string
}

export function SessionDetail({ sessionId }: SessionDetailProps) {
    const { t } = useTranslation()
    const navigate = useNavigate()
    const { data: session, isLoading, error } = useSession(sessionId)

    // 进入 session 详情页时清零未读角标
    const clearBadge = useNotificationBadgeStore((s) => s.clearBadge)
    useEffect(() => {
        if (sessionId) clearBadge(sessionId)
    }, [sessionId, clearBadge])

    const agentStatus = useMemo(
        () =>
            getAgentStatus({
                active: session?.active ?? false,
                running: session?.running ?? false,
                agentState: session?.agentState ?? null,
            }),
        [session?.active, session?.running, session?.agentState],
    )

    // 输出中或等待权限确认时，保持屏幕常亮（PWA/移动端避免错过进度与权限请求）
    useWakeLock(agentStatus === 'outputting' || agentStatus === 'awaiting_auth')

    if (isLoading) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
                <Spin size="large" />
            </div>
        )
    }

    if (error || !session) {
        return (
            <Result
                status="error"
                title={t('session.loadFailed')}
                subTitle={t('session.notFound')}
                extra={
                    <Button type="primary" onClick={() => navigate({ to: '/' })}>
                        {t('common.backHome')}
                    </Button>
                }
            />
        )
    }

    const displayName = getSessionDisplayName(session)

    return (
        <WorkspaceSplitter
            sessionId={sessionId}
            left={
                <ChatPane
                    sessionId={sessionId}
                    session={session}
                    displayName={displayName}
                    agentStatus={agentStatus}
                />
            }
            right={<InspectorPane sessionId={sessionId} active={session?.active ?? false} />}
        />
    )
}
