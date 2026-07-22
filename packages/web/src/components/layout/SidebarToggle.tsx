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
import styled from '@emotion/styled'
import { PanelLeft } from 'lucide-react'
import { useUiStore } from '@/core/data/stores/uiStore'
import { useIsMobile } from '@/core/data/hooks/useMediaQuery'
import { useWindowControlsOverlay } from './useWindowControlsOverlay'

const { useToken } = antTheme

const StyledButton = styled.button<{ $token: ReturnType<typeof useToken>['token'] }>`
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    background: transparent;
    color: ${props => props.$token.colorTextSecondary};
    flex-shrink: 0;
    transition: background 0.2s, color 0.2s;

    &:hover {
        background: ${props => props.$token.colorBgTextHover};
        color: ${props => props.$token.colorText};
    }
`

/**
 * 侧边栏展开按钮
 * 仅在桌面端且侧边栏收起时显示，放在 PageHeader 的 left 区域
 */
export function SidebarToggle() {
    const { token } = useToken()
    const isMobile = useIsMobile()
    const sidebarExpanded = useUiStore((s) => s.sidebarExpanded)
    const toggleSidebar = useUiStore((s) => s.toggleSidebar)
    // WCO 模式下标题栏已有收起/展开按钮，主内容区不重复渲染
    const isWco = useWindowControlsOverlay()

    if (isWco || isMobile || sidebarExpanded) return null

    return (
        <StyledButton $token={token} onClick={toggleSidebar} aria-label="展开侧边栏">
            <PanelLeft size={18} />
        </StyledButton>
    )
}
