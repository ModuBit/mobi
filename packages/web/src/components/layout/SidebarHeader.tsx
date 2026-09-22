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
import { Logo } from './Logo'
import { MobiWordmark } from './MobiWordmark'
import { UpdateIconButton } from './UpdatePrompt'
import { useUiStore } from '@/core/data/stores/uiStore'
import { useUpdateAvailable } from '@/core/pwa/useUpdateAvailable'

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
`

// Logo 图标尺寸
const LogoIcon = styled(Logo)`
    width: 28px;
    height: 28px;
`

// 品牌名（仅承载 color，字标尺寸由 MobiWordmark 自身控制）
const BrandName = styled.span<{ $token: ReturnType<typeof useToken>['token'] }>`
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
        // hover 淡档、选中（如展开中的菜单入口）才用 colorPrimaryBg 深半档
        background: ${props => props.$token.colorBgTextHover};
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
    // PWA 新版本可用 → logo 旁出现低调更新入口（移动端不渲染本组件，走 UpdatePrompt 悬浮钮）
    const updateReload = useUpdateAvailable()

    return (
        <HeaderContainer $token={token}>
            {/* Logo - 点击跳转新对话 */}
            <LogoArea
                $token={token}
                onClick={() => navigate({ to: '/sessions/new', search: {} })}
            >
                <LogoIcon />
                <BrandName $token={token}><MobiWordmark size={15} /></BrandName>
            </LogoArea>

            {/* 发现新版本 - 点击刷新生效 */}
            {updateReload && <UpdateIconButton onUpdate={updateReload} />}

            {/* 收起侧边栏（aria-label 与 WcoTitleBar 同功能按钮一致） */}
            <CollapseButton $token={token} onClick={toggleSidebar} aria-label="收起侧边栏">
                <PanelLeftClose size={18} />
            </CollapseButton>
        </HeaderContainer>
    )
}
