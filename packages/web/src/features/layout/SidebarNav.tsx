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
import { GlideLayer } from '@/ui/base/motion/GlideLayer'
import { useGlideHighlight } from '@/ui/base/motion/useGlideHighlight'
import { mainNavItems, navPathMap, getNavActiveKey } from './navConfig'

const { useToken } = antTheme

// 导航列表容器（相对定位供滑移底色层定位）
const NavList = styled.div`
    position: relative;
    display: flex;
    flex-direction: column;
    padding: 8px;
    gap: 2px;
`

// 单个导航项（底色由滑移层绘制，行只负责定位与文字色）
const NavItem = styled.button<{ $active: boolean; $disabled?: boolean; $token: ReturnType<typeof useToken>['token'] }>`
    position: relative;
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    height: 36px;
    padding: 0 12px;
    border: none;
    background: transparent;
    color: ${props => {
        if (props.$disabled) return props.$token.colorTextQuaternary
        return props.$active ? props.$token.colorPrimary : props.$token.colorTextSecondary
    }};
    border-radius: var(--radius-icon);
    cursor: ${props => props.$disabled ? 'not-allowed' : 'pointer'};
    font-size: 13px;
    line-height: 1;
    transition: color 0.2s;

    &:hover {
        ${props => !props.$disabled && `color: ${props.$token.colorPrimary};`}
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

    // 悬停 / 激活两档滑移底色（与会话列表同一套弹簧手感）
    const { containerRef, hoverEl, activeEl, onPointerOver, onPointerLeave } =
        useGlideHighlight<HTMLDivElement>({
            rowSelector: '[data-glide-row]',
            activeSelector: '[data-glide-active="true"]',
            activeKey: location.pathname,
        })

    return (
        <NavList ref={containerRef} onPointerOver={onPointerOver} onPointerLeave={onPointerLeave}>
            <GlideLayer target={hoverEl} $background={token.colorBgTextHover} />
            <GlideLayer target={activeEl} $background={token.colorPrimaryBg} />
            {mainNavItems.map((item) => {
                const active = getNavActiveKey(location.pathname, item.key)
                return (
                    <NavItem
                        key={item.key}
                        $active={active}
                        $disabled={item.disabled}
                        $token={token}
                        data-glide-row={item.disabled ? undefined : ''}
                        data-glide-active={active && !item.disabled ? 'true' : undefined}
                        onClick={() => handleClick(item.key, item.disabled)}
                    >
                        <item.icon size={18} />
                        <span>{t(item.labelKey)}</span>
                    </NavItem>
                )
            })}
        </NavList>
    )
}
