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

import { theme as antTheme, Tooltip, Dropdown } from 'antd'
import { useTranslation } from 'react-i18next'
import { useMemo } from 'react'
import { useUiStore } from '@/stores/uiStore'
import { useAuthStore } from '@/stores/authStore'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { mainNavItems, bottomNavItems, logoutNavItem } from './navConfig'
import { User } from 'lucide-react'
import type { MenuProps } from 'antd'
import styled from '@emotion/styled'

const { useToken } = antTheme

// 桌面端：左侧垂直导航栏
const SidebarContainer = styled.div<{ $token: ReturnType<typeof useToken>['token'] }>`
    width: 56px;
    height: 100vh;
    background: ${props => props.$token.colorBgContainer};
    border-right: 1px solid ${props => props.$token.colorBorder};
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 12px 0;
`

const LogoContainer = styled.div<{ $token: ReturnType<typeof useToken>['token'] }>`
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 16px;
    color: ${props => props.$token.colorPrimary};
`

const LogoImage = styled.img`
    width: 32px;
    height: 32px;
`

const NavItem = styled.button<{ $active: boolean; $token: ReturnType<typeof useToken>['token'] }>`
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: ${props => props.$active ? props.$token.colorPrimaryBg : 'transparent'};
    color: ${props => props.$active ? props.$token.colorPrimary : props.$token.colorTextSecondary};
    border-radius: 8px;
    cursor: ${props => props.disabled ? 'not-allowed' : 'pointer'};
    opacity: ${props => props.disabled ? 0.4 : 1};
    transition: all 0.2s;
    margin-bottom: 4px;

    &:hover:not(:disabled) {
        background: ${props => props.$token.colorPrimaryBg};
        color: ${props => props.$token.colorPrimary};
    }
`

const Spacer = styled.div`
    flex: 1;
`

export function RailNav() {
    const { token } = useToken()
    const { t } = useTranslation()
    const { activeModule, setActiveModule } = useUiStore()
    const { logout } = useAuthStore()
    const isMobile = useIsMobile()

    // 移动端不显示侧边导航栏
    if (isMobile) {
        return null
    }

    // 用户菜单项 - 使用 useMemo 避免每次渲染重新创建
    const userMenuItems: MenuProps['items'] = useMemo(() => [
        {
            key: logoutNavItem.key,
            label: t(logoutNavItem.labelKey),
            icon: <logoutNavItem.icon size={16} />,
            onClick: logout,
        },
    ], [t, logout])

    // 桌面端：左侧垂直导航栏
    return (
        <SidebarContainer $token={token}>
            {/* Logo */}
            <LogoContainer $token={token}>
                <LogoImage src="/logo.svg" alt="Mobi" />
            </LogoContainer>

            {/* 主导航 */}
            {mainNavItems.map((item) => (
                <Tooltip
                    key={item.key}
                    title={t(item.labelKey)}
                    placement="right"
                >
                    <NavItem
                        $active={activeModule === item.key}
                        $token={token}
                        disabled={item.disabled}
                        onClick={() => !item.disabled && setActiveModule(item.key as typeof activeModule)}
                    >
                        <item.icon size={20} />
                    </NavItem>
                </Tooltip>
            ))}

            <Spacer />

            {/* 底部导航 */}
            {bottomNavItems.map((item) => (
                <Tooltip
                    key={item.key}
                    title={t(item.labelKey)}
                    placement="right"
                >
                    <NavItem
                        $active={activeModule === item.key}
                        $token={token}
                        onClick={() => setActiveModule(item.key as typeof activeModule)}
                    >
                        <item.icon size={20} />
                    </NavItem>
                </Tooltip>
            ))}

            {/* 用户菜单 */}
            <Dropdown
                menu={{ items: userMenuItems }}
                trigger={['click']}
                placement="topRight"
            >
                <NavItem
                    $active={false}
                    $token={token}
                    as="div"
                >
                    <User size={20} />
                </NavItem>
            </Dropdown>
        </SidebarContainer>
    )
}
