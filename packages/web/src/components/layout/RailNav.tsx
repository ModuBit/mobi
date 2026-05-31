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
import { useNavigate, useLocation } from '@tanstack/react-router'
import { useAuthStore } from '@/core/data/stores/authStore'
import { useIsMobile } from '@/core/data/hooks/useMediaQuery'
import { mainNavItems, bottomNavItems, logoutNavItem, navPathMap, getNavActiveKey } from './navConfig'
import { useThemeLocaleToggle } from './useThemeLocaleToggle'
import { InstallButton } from './InstallButton'
import { User, Sun, Moon } from 'lucide-react'
import type { MenuProps } from 'antd'
import styled from '@emotion/styled'

const { useToken } = antTheme

// 桌面端：左侧垂直导航栏
const SidebarContainer = styled.div<{ $token: ReturnType<typeof useToken>['token'] }>`
    width: 56px;
    height: 100vh;
    background: ${props => props.$token.colorBgContainer};
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
    cursor: pointer;
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

const Divider = styled.div<{ $token: ReturnType<typeof useToken>['token'] }>`
    width: 24px;
    height: 1px;
    background: ${props => props.$token.colorBorder};
    margin: 8px 0;
`

const Spacer = styled.div`
    flex: 1;
`

export function RailNav() {
    const { token } = useToken()
    const { t } = useTranslation()
    const navigate = useNavigate()
    const location = useLocation()
    const { logout } = useAuthStore()
    const { resolvedTheme, locale, toggleTheme, toggleLocale } = useThemeLocaleToggle()
    const isMobile = useIsMobile()

    // 用户菜单项 - 使用 useMemo 避免每次渲染重新创建（必须在条件返回之前）
    const userMenuItems: MenuProps['items'] = useMemo(() => [
        {
            key: logoutNavItem.key,
            label: t(logoutNavItem.labelKey),
            icon: <logoutNavItem.icon size={16} />,
            onClick: logout,
        },
    ], [t, logout])

    // 处理导航点击
    const handleNavClick = (key: string, disabled?: boolean) => {
        if (disabled) return
        const path = navPathMap[key]
        if (path) {
            navigate({ to: path })
        }
    }

    // 移动端不显示侧边导航栏
    if (isMobile) {
        return null
    }

    // 桌面端：左侧垂直导航栏
    return (
        <SidebarContainer $token={token}>
            {/* Logo - 点击跳转到会话列表 */}
            <LogoContainer
                $token={token}
                onClick={() => navigate({ to: '/sessions' })}
            >
                <LogoImage src="/logo.svg" alt="Mobi" />
            </LogoContainer>

            <Divider $token={token} />

            {/* 主导航 */}
            {mainNavItems.map((item) => (
                <Tooltip
                    key={item.key}
                    title={t(item.labelKey)}
                    placement="right"
                >
                    <NavItem
                        $active={getNavActiveKey(location.pathname, item.key)}
                        $token={token}
                        disabled={item.disabled}
                        onClick={() => handleNavClick(item.key, item.disabled)}
                    >
                        <item.icon size={20} />
                    </NavItem>
                </Tooltip>
            ))}

            <Spacer />

            {/* PWA 安装按钮 */}
            <InstallButton />

            {/* 底部导航 */}
            {bottomNavItems.map((item) => (
                <Tooltip
                    key={item.key}
                    title={t(item.labelKey)}
                    placement="right"
                >
                    <NavItem
                        $active={getNavActiveKey(location.pathname, item.key)}
                        $token={token}
                        onClick={() => handleNavClick(item.key)}
                    >
                        <item.icon size={20} />
                    </NavItem>
                </Tooltip>
            ))}

            {/* 主题切换 */}
            <Tooltip
                title={resolvedTheme === 'dark' ? t('nav.themeLight') : t('nav.themeDark')}
                placement="right"
            >
                <NavItem
                    $active={false}
                    $token={token}
                    onClick={toggleTheme}
                >
                    {resolvedTheme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
                </NavItem>
            </Tooltip>

            {/* 语言切换 */}
            <Tooltip
                title={locale === 'zh' ? 'English' : '中文'}
                placement="right"
            >
                <NavItem
                    $active={false}
                    $token={token}
                    onClick={toggleLocale}
                >
                    <span style={{ fontSize: 12, fontWeight: 600 }}>
                        {locale === 'zh' ? 'En' : '中'}
                    </span>
                </NavItem>
            </Tooltip>

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
