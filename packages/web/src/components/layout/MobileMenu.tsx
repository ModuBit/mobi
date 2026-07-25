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

import { theme as antTheme } from 'antd'
import { useTranslation } from 'react-i18next'
import { useNavigate, useLocation } from '@tanstack/react-router'
import { useUiStore } from '@/core/data/stores/uiStore'
import { useAuthStore } from '@/core/data/stores/authStore'
import { useMobiApi } from '@/core/data/api/client'
import { useIsMobile } from '@/core/data/hooks/useMediaQuery'
import { mobileNavItems, logoutNavItem, navPathMap, getNavActiveKey } from './navConfig'
import { useThemeLocaleToggle } from './useThemeLocaleToggle'
import { MobileProjectList } from './MobileProjectList'
import { MobileDrawer } from '@/components/ui/MobileDrawer'
import { Menu, Sun, Moon, Languages, RefreshCw } from 'lucide-react'
import { InstallButton } from './InstallButton'
import { useForceUpdate } from '@/core/pwa/useForceUpdate'
import styled from '@emotion/styled'

const { useToken } = antTheme

const MenuButton = styled.button<{ $token: ReturnType<typeof useToken>['token'] }>`
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: transparent;
    color: ${props => props.$token.colorText};
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.2s;

    @media (hover: hover) {
        &:hover {
            background: ${props => props.$token.colorPrimaryBg};
            color: ${props => props.$token.colorPrimary};
        }
    }

    &:active {
        background: ${props => props.$token.colorPrimaryBg};
        color: ${props => props.$token.colorPrimary};
    }
`

const MenuContent = styled.div<{ $token: ReturnType<typeof useToken>['token'] }>`
    background: ${props => props.$token.colorBgContainer};
`

const MenuItem = styled.div<{ $active: boolean; $danger?: boolean; $token: ReturnType<typeof useToken>['token'] }>`
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 16px 20px;
    cursor: pointer;
    color: ${props => {
        if (props.$danger) return props.$token.colorError
        return props.$active ? props.$token.colorPrimary : props.$token.colorText
    }};
    background: ${props => props.$active ? props.$token.colorPrimaryBg : 'transparent'};
    transition: all 0.2s;
    ${props => props.$danger ? `border-top: 1px solid ${props.$token.colorBorder};` : ''}

    @media (hover: hover) {
        &:hover {
            background: ${props => props.$token.colorPrimaryBg};
        }
    }

    &:active {
        background: ${props => props.$token.colorPrimaryBg};
    }
`

// 汉堡菜单按钮
export function MobileMenuButton() {
    const { token } = useToken()
    const { t } = useTranslation()
    const { setMobileMenuOpen } = useUiStore()
    const isMobile = useIsMobile()

    if (!isMobile) return null

    return (
        <MenuButton
            $token={token}
            onClick={() => setMobileMenuOpen(true)}
            aria-label={t('nav.menu')}
        >
            <Menu size={20} />
        </MenuButton>
    )
}

// 底部弹出的菜单
export function MobileMenuDrawer() {
    const { token } = useToken()
    const { t } = useTranslation()
    const navigate = useNavigate()
    const location = useLocation()
    const { mobileMenuOpen, setMobileMenuOpen } = useUiStore()
    const { logout } = useAuthStore()
    const api = useMobiApi()
    const isMobile = useIsMobile()
    const { resolvedTheme, locale, toggleTheme, toggleLocale } = useThemeLocaleToggle()
    const checkUpdate = useForceUpdate()

    // 关闭菜单
    const handleClose = () => setMobileMenuOpen(false)

    // 登出：先清服务端 cookie，再清内存 state（cookie 链路下两步缺一不可）
    const handleLogout = () => {
        handleClose()
        api.auth.logout().catch(() => {}).finally(() => logout())
    }

    // 选择菜单项
    const handleSelect = (key: string) => {
        const path = navPathMap[key]
        if (path) {
            navigate({ to: path })
        }
        handleClose()
    }

    // 非移动端不渲染
    if (!isMobile) return null

    // 将菜单项拆分为「新建会话」和「设置」两组，中间插入项目列表
    const topItems = mobileNavItems.filter(item => item.key === 'new-session')
    const bottomItems = mobileNavItems.filter(item => item.key !== 'new-session')

    return (
        <MobileDrawer
            title={t('nav.menu')}
            open={mobileMenuOpen}
            onClose={handleClose}
            styles={{ body: { padding: 0, overflow: 'auto' } }}
        >
            <MenuContent $token={token}>
                {/* 新建会话 */}
                {topItems.map((item) => (
                    <MenuItem
                        key={item.key}
                        $active={getNavActiveKey(location.pathname, item.key)}
                        $token={token}
                        onClick={() => handleSelect(item.key)}
                    >
                        <item.icon size={20} />
                        <span>{t(item.labelKey)}</span>
                    </MenuItem>
                ))}

                {/* 项目列表 */}
                <MobileProjectList onCloseMenu={handleClose} />

                {/* 设置等 */}
                {bottomItems.map((item) => (
                    <MenuItem
                        key={item.key}
                        $active={getNavActiveKey(location.pathname, item.key)}
                        $token={token}
                        onClick={() => handleSelect(item.key)}
                    >
                        <item.icon size={20} />
                        <span>{t(item.labelKey)}</span>
                    </MenuItem>
                ))}

                {/* PWA 安装按钮 */}
                <InstallButton variant="menu" />

                {/* 主题 & 语言切换 */}
                <div style={{ display: 'flex', alignItems: 'stretch' }}>
                    <MenuItem
                        $active={false}
                        $token={token}
                        style={{ flex: 1, justifyContent: 'center' }}
                        onClick={toggleTheme}
                    >
                        {resolvedTheme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
                        <span>{resolvedTheme === 'dark' ? t('nav.themeLight') : t('nav.themeDark')}</span>
                    </MenuItem>
                    <div style={{ width: 1, alignSelf: 'stretch', background: token.colorBorder, margin: '8px 0' }} />
                    <MenuItem
                        $active={false}
                        $token={token}
                        style={{ flex: 1, justifyContent: 'center' }}
                        onClick={toggleLocale}
                    >
                        <Languages size={20} />
                        <span>{locale === 'zh' ? 'English' : '中文'}</span>
                    </MenuItem>
                </div>

                {/* 检查更新(清缓存硬刷新) */}
                <MenuItem
                    $active={false}
                    $token={token}
                    onClick={() => {
                        handleClose()
                        checkUpdate()
                    }}
                >
                    <RefreshCw size={20} />
                    <span>{t('nav.checkUpdate')}</span>
                </MenuItem>

                <MenuItem
                    $active={false}
                    $danger={true}
                    $token={token}
                    onClick={() => {
                        handleLogout()
                    }}
                >
                    <logoutNavItem.icon size={20} />
                    <span>{t(logoutNavItem.labelKey)}</span>
                </MenuItem>
            </MenuContent>
        </MobileDrawer>
    )
}
