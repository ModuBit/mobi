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

import { useNavigate } from '@tanstack/react-router'
import { theme as antTheme } from 'antd'
import { PanelLeftClose } from 'lucide-react'
import styled from '@emotion/styled'
import { Icon } from './Icon'
import { useUiStore } from '@/core/data/stores/uiStore'

const { useToken } = antTheme

// 顶部容器
const HeaderContainer = styled.div<{ $token: ReturnType<typeof useToken>['token'] }>`
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 48px;
    padding: 0 12px;
    flex-shrink: 0;
`

// Logo 区域（可点击）
const LogoArea = styled.div<{ $token: ReturnType<typeof useToken>['token'] }>`
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    color: ${props => props.$token.colorPrimary};
    border-radius: 6px;
    padding: 4px;
    transition: background 0.2s;

    &:hover {
        background: ${props => props.$token.colorPrimaryBg};
    }
`

// Logo 图标尺寸
const LogoIcon = styled(Icon)`
    width: 28px;
    height: 28px;
`

// 品牌名
const BrandName = styled.span<{ $token: ReturnType<typeof useToken>['token'] }>`
    font-size: 16px;
    font-weight: 700;
    letter-spacing: 1px;
    color: ${props => props.$token.colorText};
`

// 收起按钮
const CollapseButton = styled.button<{ $token: ReturnType<typeof useToken>['token'] }>`
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
 * 侧边栏顶部区域
 * 左侧 Logo + 右侧收起按钮
 */
export function SidebarHeader() {
    const { token } = useToken()
    const navigate = useNavigate()
    const toggleSidebar = useUiStore((s) => s.toggleSidebar)

    return (
        <HeaderContainer $token={token}>
            {/* Logo - 点击跳转新对话 */}
            <LogoArea
                $token={token}
                onClick={() => navigate({ to: '/sessions/new' })}
            >
                <LogoIcon />
                <BrandName $token={token}>MOBI</BrandName>
            </LogoArea>

            {/* 收起侧边栏 */}
            <CollapseButton $token={token} onClick={toggleSidebar}>
                <PanelLeftClose size={18} />
            </CollapseButton>
        </HeaderContainer>
    )
}
