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
import { useSessions } from '@/hooks/queries/useSessions'
import { ContentSidebar } from '@/components/layout/ContentSidebar'
import { MobileMenuButton } from '@/components/layout/MobileMenu'
import { SessionCard } from '@/components/session/SessionCard'
import { PlusOutlined } from '@ant-design/icons'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { useMemo } from 'react'
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

const HeaderLeft = styled.div`
    display: flex;
    align-items: center;
    gap: 8px;
`

const SessionListContainer = styled.div`
    flex: 1;
    overflow-y: auto;
    padding: 8px 4px;
`

const EmptyContainer = styled.div`
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    flex: 1;
`

// 移动端容器 - 全屏显示
const MobileContainer = styled.div<{ $token: ReturnType<typeof useToken>['token'] }>`
    width: 100%;
    height: 100%;
    background: ${props => props.$token.colorBgContainer};
    display: flex;
    flex-direction: column;
    overflow: hidden;
`

/**
 * 会话列表页面
 * 显示所有会话的列表，点击会话跳转到详情页
 */
export function SessionsPage() {
    const { token } = useToken()
    const { t } = useTranslation()
    const { data: sessions = [], isLoading } = useSessions()
    const isMobile = useIsMobile()

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

    // 移动端只显示列表
    if (isMobile) {
        return (
            <MobileContainer $token={token}>
                <SidebarHeader $token={token}>
                    <HeaderLeft>
                        <MobileMenuButton />
                        <Title level={5} style={{ margin: 0 }}>{t('home.title')}</Title>
                    </HeaderLeft>
                    <Button
                        type="primary"
                        icon={<PlusOutlined />}
                        size="small"
                        onClick={handleNewSession}
                    />
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
                            />
                        ))
                    )}
                </SessionListContainer>
            </MobileContainer>
        )
    }

    // 桌面端：列表 + 空状态提示
    return (
        <>
            <ContentSidebar>
                <SidebarHeader $token={token}>
                    <HeaderLeft>
                        <MobileMenuButton />
                        <Title level={5} style={{ margin: 0 }}>{t('home.title')}</Title>
                    </HeaderLeft>
                    <Button
                        type="primary"
                        icon={<PlusOutlined />}
                        size="small"
                        onClick={handleNewSession}
                    />
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
                            />
                        ))
                    )}
                </SessionListContainer>
            </ContentSidebar>

            <EmptyContainer style={{ color: token.colorTextSecondary }}>
                <Empty description={t('session.empty')} />
            </EmptyContainer>
        </>
    )
}
