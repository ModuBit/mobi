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

import { theme as antTheme, Tooltip } from 'antd'
import { useTranslation } from 'react-i18next'
import { useUiStore } from '@/stores/uiStore'
import {
    Bot,
    MessageSquare,
    Zap,
    Plug,
    Settings,
} from 'lucide-react'
import styled from '@emotion/styled'

const { useToken } = antTheme

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

const navItems: Array<{
    key: string
    icon: typeof MessageSquare
    tooltipKey: string
    disabled?: boolean
}> = [
    { key: 'sessions', icon: MessageSquare, tooltipKey: 'nav.sessions' },
    { key: 'skills', icon: Zap, tooltipKey: 'nav.skills', disabled: true },
    { key: 'mcp', icon: Plug, tooltipKey: 'nav.mcp', disabled: true },
]

const bottomItems = [
    { key: 'settings', icon: Settings, tooltipKey: 'nav.settings' },
] as const

export function RailNav() {
    const { token } = useToken()
    const { t } = useTranslation()
    const { activeModule, setActiveModule } = useUiStore()

    return (
        <SidebarContainer $token={token}>
            {/* Logo */}
            <LogoContainer $token={token}>
                <Bot size={28} />
            </LogoContainer>

            {/* 主导航 */}
            {navItems.map((item) => (
                <Tooltip
                    key={item.key}
                    title={t(item.tooltipKey)}
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
            {bottomItems.map((item) => (
                <Tooltip
                    key={item.key}
                    title={t(item.tooltipKey)}
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
        </SidebarContainer>
    )
}
