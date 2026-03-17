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

import { theme as antTheme, Button, Typography } from 'antd'
import { useTranslation } from 'react-i18next'
import { Outlet, useParams } from '@tanstack/react-router'
import { ContentSidebar } from '@/components/layout/ContentSidebar'
import { MobileMenuButton } from '@/components/layout/MobileMenu'
import { SessionGroupList } from '@/components/session/SessionGroupList'
import { PlusOutlined } from '@ant-design/icons'
import { useIsMobile } from '@/hooks/useMediaQuery'
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

const MainContentArea = styled.div`
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
`

// 移动端全屏容器
const MobileContainer = styled.div<{ $token: ReturnType<typeof useToken>['token'] }>`
    width: 100%;
    height: 100%;
    background: ${props => props.$token.colorBgContainer};
    display: flex;
    flex-direction: column;
    overflow: hidden;
`

/**
 * 会话布局组件
 * 左侧显示分组会话列表，右侧通过 Outlet 渲染子路由内容
 */
export function SessionsLayout() {
    const { token } = useToken()
    const { t } = useTranslation()
    const isMobile = useIsMobile()
    const params = useParams({ strict: false })
    const sessionId = params.sessionId as string | undefined

    const handleNewSession = () => {
        // TODO: 实现新建会话
        console.log('New session')
    }

    // 移动端：有选中会话时只显示详情，否则显示列表
    if (isMobile) {
        if (sessionId) {
            return (
                <MainContentArea>
                    <Outlet />
                </MainContentArea>
            )
        }
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
                <SessionGroupList />
            </MobileContainer>
        )
    }

    // 桌面端：左侧列表 + 右侧内容区
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
                <SessionGroupList selectedSessionId={sessionId} />
            </ContentSidebar>

            <MainContentArea>
                <Outlet />
            </MainContentArea>
        </>
    )
}
