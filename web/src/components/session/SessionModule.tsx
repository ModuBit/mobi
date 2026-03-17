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

import { theme as antTheme, Button, Typography, Empty, Skeleton } from 'antd'
import { useTranslation } from 'react-i18next'
import { useNavigate, useLocation } from '@tanstack/react-router'
import { useSessions } from '@/hooks/queries/useSessions'
import { useUiStore } from '@/stores/uiStore'
import { useAuthStore } from '@/stores/authStore'
import { ContentSidebar } from '@/components/layout/ContentSidebar'
import { SessionDetail } from './SessionDetail'
import { SessionCard } from './SessionCard'
import { PlusOutlined, LogoutOutlined } from '@ant-design/icons'
import { useEffect, useMemo } from 'react'
import styled from '@emotion/styled'

const { Title } = Typography
const { useToken } = antTheme

const SidebarHeader = styled.div<{ $token: ReturnType<typeof useToken>['token'] }>`
    padding: 16px 12px;
    border-bottom: 1px solid ${props => props.$token.colorBorder};
    display: flex;
    justify-content: space-between;
    align-items: center;
`

const SessionListContainer = styled.div`
    flex: 1;
    overflow-y: auto;
    padding: 8px 4px;
`

const MainContentArea = styled.div`
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
`

// 从路径解析 sessionId
function getSessionIdFromPath(pathname: string): string | null {
    const match = pathname.match(/\/sessions\/([^/]+)/)
    return match ? match[1] : null
}

export function SessionModule() {
    const { token } = useToken()
    const { t } = useTranslation()
    const navigate = useNavigate()
    const location = useLocation()
    const { logout } = useAuthStore()
    const { data: sessions = [], isLoading } = useSessions()
    const { setSessionViewMode } = useUiStore()

    // 使用 TanStack Router 的 useLocation 响应式获取 sessionId
    const sessionId = useMemo(
        () => getSessionIdFromPath(location.pathname),
        [location.pathname]
    )

    // 切换会话时重置视图模式
    useEffect(() => {
        if (sessionId) {
            setSessionViewMode('chat')
        }
    }, [sessionId, setSessionViewMode])

    // 使用 useMemo 缓存排序结果
    const sortedSessions = useMemo(() => {
        return [...sessions].sort((a, b) => {
            if (a.active !== b.active) return a.active ? -1 : 1
            return (b.updatedAt || 0) - (a.updatedAt || 0)
        })
    }, [sessions])

    const handleNewSession = () => {
        // TODO: 实现新建会话
        console.log('New session')
    }

    return (
        <>
            {/* 左侧会话列表 */}
            <ContentSidebar>
                <SidebarHeader $token={token}>
                    <Title level={5} style={{ margin: 0 }}>{t('home.title')}</Title>
                    <div style={{ display: 'flex', gap: 4 }}>
                        <Button
                            type="primary"
                            icon={<PlusOutlined />}
                            size="small"
                            onClick={handleNewSession}
                        />
                        <Button
                            icon={<LogoutOutlined />}
                            size="small"
                            onClick={logout}
                        />
                    </div>
                </SidebarHeader>
                <SessionListContainer>
                    {isLoading ? (
                        <Skeleton active paragraph={{ rows: 4 }} style={{ padding: 16 }} />
                    ) : sortedSessions.length === 0 ? (
                        <Empty description={t('session.empty')} style={{ marginTop: 40 }} />
                    ) : (
                        sortedSessions.map((session) => (
                            <SessionCard
                                key={session.id}
                                session={session}
                                active={sessionId === session.id}
                            />
                        ))
                    )}
                </SessionListContainer>
            </ContentSidebar>

            {/* 右侧会话详情 */}
            <MainContentArea>
                {sessionId ? (
                    <SessionDetail sessionId={sessionId} />
                ) : (
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        height: '100%',
                        color: token.colorTextSecondary
                    }}>
                        <Empty description={t('session.empty')} />
                    </div>
                )}
            </MainContentArea>
        </>
    )
}
