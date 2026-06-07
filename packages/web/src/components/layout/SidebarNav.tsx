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

import { useLocation, useNavigate } from '@tanstack/react-router'
import { theme as antTheme } from 'antd'
import { useTranslation } from 'react-i18next'
import styled from '@emotion/styled'
import { mainNavItems, navPathMap, getNavActiveKey } from './navConfig'

const { useToken } = antTheme

// 导航列表容器
const NavList = styled.div`
    display: flex;
    flex-direction: column;
    padding: 8px;
    gap: 2px;
`

// 单个导航项
const NavItem = styled.button<{ $active: boolean; $disabled?: boolean; $token: ReturnType<typeof useToken>['token'] }>`
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    height: 36px;
    padding: 0 12px;
    border: none;
    background: ${props => props.$active ? props.$token.colorPrimaryBg : 'transparent'};
    color: ${props => {
        if (props.$disabled) return props.$token.colorTextQuaternary
        return props.$active ? props.$token.colorPrimary : props.$token.colorTextSecondary
    }};
    border-radius: 6px;
    cursor: ${props => props.$disabled ? 'not-allowed' : 'pointer'};
    font-size: 13px;
    line-height: 1;
    transition: all 0.2s;

    &:hover:not(:disabled) {
        background: ${props => props.$token.colorPrimaryBg};
        color: ${props => props.$token.colorPrimary};
    }
`

/**
 * 侧边栏导航区域
 * 渲染主导航项列表
 */
export function SidebarNav() {
    const { token } = useToken()
    const { t } = useTranslation()
    const navigate = useNavigate()
    const location = useLocation()

    // 处理导航点击
    const handleClick = (key: string, disabled?: boolean) => {
        if (disabled) return
        const path = navPathMap[key]
        if (path) {
            navigate({ to: path })
        }
    }

    return (
        <NavList>
            {mainNavItems.map((item) => (
                <NavItem
                    key={item.key}
                    $active={getNavActiveKey(location.pathname, item.key)}
                    $disabled={item.disabled}
                    $token={token}
                    onClick={() => handleClick(item.key, item.disabled)}
                >
                    <item.icon size={18} />
                    <span>{t(item.labelKey)}</span>
                </NavItem>
            ))}
        </NavList>
    )
}
