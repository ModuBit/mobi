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

import { theme as antTheme, Button, Typography, Empty } from 'antd'
import { useTranslation } from 'react-i18next'
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

const SessionListContainer = styled.div`
    flex: 1;
    overflow-y: auto;
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
 * 显示所有会话的分组列表，点击会话跳转到详情页
 */
export function SessionsPage() {
    const { token } = useToken()
    const { t } = useTranslation()
    const isMobile = useIsMobile()

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
                    <SessionGroupList />
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
                    <SessionGroupList />
                </SessionListContainer>
            </ContentSidebar>

            <EmptyContainer style={{ color: token.colorTextSecondary }}>
                <Empty description={t('session.selectToView')} />
            </EmptyContainer>
        </>
    )
}
