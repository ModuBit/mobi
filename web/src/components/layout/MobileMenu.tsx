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

import { theme as antTheme, Drawer } from 'antd'
import { useTranslation } from 'react-i18next'
import { useNavigate, useLocation } from '@tanstack/react-router'
import { useUiStore } from '@/stores/uiStore'
import { useAuthStore } from '@/stores/authStore'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { mobileNavItems, logoutNavItem, navPathMap, getNavActiveKey } from './navConfig'
import { Menu } from 'lucide-react'
import styled from '@emotion/styled'

const { useToken } = antTheme

const MenuButton = styled.button<{ $token: ReturnType<typeof useToken>['token'] }>`
    position: fixed;
    left: 16px;
    top: 16px;
    width: 40px;
    height: 40px;
    border-radius: 8px;
    border: 1px solid ${props => props.$token.colorBorder};
    background: ${props => props.$token.colorBgContainer};
    color: ${props => props.$token.colorTextSecondary};
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    z-index: 100;
    transition: all 0.2s;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);

    &:hover {
        color: ${props => props.$token.colorPrimary};
        border-color: ${props => props.$token.colorPrimary};
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
    }
`

const MenuContent = styled.div<{ $token: ReturnType<typeof useToken>['token'] }>`
    background: ${props => props.$token.colorBgContainer};
`

const MenuItem = styled.div<{ $active: boolean; $token: ReturnType<typeof useToken>['token'] }>`
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 16px 20px;
    cursor: pointer;
    color: ${props => props.$active ? props.$token.colorPrimary : props.$token.colorText};
    background: ${props => props.$active ? props.$token.colorPrimaryBg : 'transparent'};
    transition: all 0.2s;

    &:hover {
        background: ${props => props.$token.colorPrimaryBg};
    }

    &:last-child {
        border-top: 1px solid ${props => props.$token.colorBorder};
        margin-top: 8px;
        color: ${props => props.$token.colorError};
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
    const isMobile = useIsMobile()

    // 关闭菜单
    const handleClose = () => setMobileMenuOpen(false)

    // 选择菜单项 - 使用路由导航
    const handleSelect = (key: string) => {
        const path = navPathMap[key]
        if (path) {
            navigate({ to: path })
        }
        handleClose()
    }

    // 非移动端不渲染
    if (!isMobile) return null

    return (
        <Drawer
            title={t('nav.menu')}
            open={mobileMenuOpen}
            onClose={handleClose}
            placement="bottom"
            styles={{
                body: { padding: 0, paddingBottom: 'max(24px, env(safe-area-inset-bottom))', maxHeight: '85vh', overflow: 'auto' },
                wrapper: { height: 'auto', maxHeight: '85vh' },
            }}
        >
            <MenuContent $token={token}>
                {mobileNavItems.map((item) => (
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
                <MenuItem
                    $active={false}
                    $token={token}
                    onClick={() => {
                        handleClose()
                        logout()
                    }}
                >
                    <logoutNavItem.icon size={20} />
                    <span>{t(logoutNavItem.labelKey)}</span>
                </MenuItem>
            </MenuContent>
        </Drawer>
    )
}
