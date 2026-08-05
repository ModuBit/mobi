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
    Settings,
    Sun,
    Moon,
    Languages,
    Download,
    LogOut,
    RefreshCw,
    RotateCw,
} from 'lucide-react'
import type { MenuProps } from 'antd'
import styled from '@emotion/styled'
import { useAuthStore } from '@/core/data/stores/authStore'
import { useMobiApi } from '@/core/data/api/client'
import { useThemeLocaleToggle } from './useThemeLocaleToggle'
import { usePwaInstall } from './usePwaInstall'
import { useForceUpdate } from '@/core/pwa/useForceUpdate'

const { useToken } = antTheme

// 底部容器
const FooterContainer = styled.div`
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    padding: 0 8px 12px;
`

// 设置按钮，占满宽度
const SettingsButton = styled.button<{ $token: ReturnType<typeof useToken>['token'] }>`
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    height: 36px;
    padding: 0 12px;
    border: none;
    background: transparent;
    color: ${props => props.$token.colorTextSecondary};
    border-radius: 6px;
    cursor: pointer;
    font-size: 13px;
    transition: all 0.2s;

    &:hover {
        background: ${props => props.$token.colorPrimaryBg};
        color: ${props => props.$token.colorPrimary};
    }
`

/**
 * 侧边栏底部区域
 * 设置按钮，点击弹出 Dropdown（设置/主题/语言/安装/退出）
 */
export function SidebarFooter() {
    const { token } = useToken()
    const { t } = useTranslation()
    const navigate = useNavigate()
    const { logout } = useAuthStore()
    const api = useMobiApi()
    const { resolvedTheme, locale, toggleTheme, toggleLocale } = useThemeLocaleToggle()
    const { canInstall, handleInstall } = usePwaInstall()
    const restart = useForceUpdate()

    // 登出：先清服务端 cookie，再清内存 state（cookie 链路下两步缺一不可）
    const handleLogout = () => {
        api.auth.logout().catch(() => {}).finally(() => logout())
    }

    // Dropdown 菜单项
    const menuItems: MenuProps['items'] = useMemo(() => {
        const items: MenuProps['items'] = [
            {
                key: 'settings',
                label: t('nav.settings'),
                icon: <Settings size={16} />,
                onClick: () => navigate({ to: '/settings' }),
            },
            { type: 'divider' },
            {
                key: 'theme',
                label: resolvedTheme === 'dark' ? t('nav.themeLight') : t('nav.themeDark'),
                icon: resolvedTheme === 'dark' ? <Sun size={16} /> : <Moon size={16} />,
                onClick: toggleTheme,
            },
            {
                key: 'locale',
                label: locale === 'zh' ? 'English' : '中文',
                icon: <Languages size={16} />,
                onClick: toggleLocale,
            },
            { type: 'divider' },
            {
                key: 'refresh',
                label: t('nav.refresh'),
                icon: <RotateCw size={16} />,
                onClick: () => window.location.reload(),
            },
            {
                key: 'restart',
                label: t('nav.restart'),
                icon: <RefreshCw size={16} />,
                onClick: restart,
            },
        ]

        // PWA 安装选项
        if (canInstall) {
            items.push(
                { type: 'divider' },
                {
                    key: 'install',
                    label: t('nav.installApp'),
                    icon: <Download size={16} />,
                    onClick: handleInstall,
                },
            )
        }

        items.push(
            { type: 'divider' },
            {
                key: 'logout',
                label: t('nav.logout'),
                icon: <LogOut size={16} />,
                onClick: handleLogout,
            },
        )

        return items
    }, [t, navigate, resolvedTheme, locale, toggleTheme, toggleLocale, canInstall, handleInstall, handleLogout, restart])

    return (
        <FooterContainer>
            <Dropdown
                menu={{ items: menuItems }}
                trigger={['click']}
                placement="topLeft"
            >
                <SettingsButton $token={token} type="button">
                    <Settings size={16} />
                    <span>{t('nav.settings')}</span>
                </SettingsButton>
            </Dropdown>
        </FooterContainer>
    )
}
