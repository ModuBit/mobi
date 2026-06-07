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

import { useMemo } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Dropdown, theme as antTheme } from 'antd'
import { useTranslation } from 'react-i18next'
import {
    User,
    Settings,
    Sun,
    Moon,
    Download,
    LogOut,
} from 'lucide-react'
import type { MenuProps } from 'antd'
import styled from '@emotion/styled'
import { useAuthStore } from '@/core/data/stores/authStore'
import { useThemeLocaleToggle } from './useThemeLocaleToggle'
import { usePwaInstall } from './usePwaInstall'
import { logoutNavItem } from './navConfig'

const { useToken } = antTheme

// 底部容器
const FooterContainer = styled.div<{ $token: ReturnType<typeof useToken>['token'] }>`
    display: flex;
    flex-direction: column;
    border-top: 1px solid ${props => props.$token.colorBorder};
    flex-shrink: 0;
`

// 主题/语言切换行
const ToggleRow = styled.div`
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 4px 8px;
`

// 切换按钮
const ToggleButton = styled.button<{ $token: ReturnType<typeof useToken>['token'] }>`
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border: none;
    background: transparent;
    color: ${props => props.$token.colorTextSecondary};
    border-radius: 6px;
    cursor: pointer;
    font-size: 12px;
    font-weight: 600;
    transition: all 0.2s;

    &:hover {
        background: ${props => props.$token.colorPrimaryBg};
        color: ${props => props.$token.colorPrimary};
    }
`

// 用户菜单行
const UserRow = styled.div`
    padding: 4px 8px;
`

const UserButton = styled.button<{ $token: ReturnType<typeof useToken>['token'] }>`
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border: none;
    background: transparent;
    color: ${props => props.$token.colorTextSecondary};
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.2s;

    &:hover {
        background: ${props => props.$token.colorPrimaryBg};
        color: ${props => props.$token.colorPrimary};
    }
`

/**
 * 侧边栏底部区域
 * 包含主题/语言切换、用户菜单
 */
export function SidebarFooter() {
    const { token } = useToken()
    const { t } = useTranslation()
    const navigate = useNavigate()
    const { logout } = useAuthStore()
    const { resolvedTheme, locale, toggleTheme, toggleLocale } = useThemeLocaleToggle()
    const { canInstall, handleInstall } = usePwaInstall()

    // 用户菜单项
    const userMenuItems: MenuProps['items'] = useMemo(() => {
        const items: MenuProps['items'] = [
            {
                key: 'settings',
                label: t('nav.settings'),
                icon: <Settings size={16} />,
                onClick: () => navigate({ to: '/settings' }),
            },
        ]

        // PWA 安装选项（仅在可安装时显示）
        if (canInstall) {
            items.push({
                key: 'install',
                label: t('nav.installApp'),
                icon: <Download size={16} />,
                onClick: handleInstall,
            })
        }

        items.push(
            { type: 'divider' },
            {
                key: logoutNavItem.key,
                label: t(logoutNavItem.labelKey),
                icon: <logoutNavItem.icon size={16} />,
                onClick: logout,
            },
        )

        return items
    }, [t, navigate, canInstall, handleInstall, logout])

    return (
        <FooterContainer $token={token}>
            {/* 主题/语言切换 */}
            <ToggleRow>
                <ToggleButton $token={token} onClick={toggleTheme}>
                    {resolvedTheme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
                </ToggleButton>
                <ToggleButton $token={token} onClick={toggleLocale}>
                    {locale === 'zh' ? 'En' : '中'}
                </ToggleButton>
            </ToggleRow>

            {/* 用户菜单 */}
            <UserRow>
                <Dropdown
                    menu={{ items: userMenuItems }}
                    trigger={['click']}
                    placement="topRight"
                >
                    <UserButton $token={token} as="div">
                        <User size={18} />
                    </UserButton>
                </Dropdown>
            </UserRow>
        </FooterContainer>
    )
}
