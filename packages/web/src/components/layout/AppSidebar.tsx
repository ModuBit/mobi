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
import { useUiStore } from '@/core/data/stores/uiStore'
import { useIsMobile } from '@/core/data/hooks/useMediaQuery'
import { SidebarHeader } from './SidebarHeader'
import { SidebarNav } from './SidebarNav'
import { SidebarProjects } from './SidebarProjects'
import { SidebarFooter } from './SidebarFooter'
import { useWco } from './useWindowControlsOverlay'
import { CLIP_DURATION, CLIP_EASING } from '@/components/ui/clipConstants'

const { useToken } = antTheme

// 外层容器：负责宽度动画 + 裁剪
const SidebarContainer = styled.div<{
    $token: ReturnType<typeof useToken>['token']
    $expanded: boolean
}>`
    width: ${props => props.$expanded ? '240px' : '0px'};
    flex-shrink: 0;
    overflow: hidden;
    height: 100%;
    transition: width ${CLIP_DURATION} ${CLIP_EASING};
`

// 内层容器：固定宽度，内容不被挤压，只被外层裁剪
const SidebarInner = styled.div<{
    $token: ReturnType<typeof useToken>['token']
    $expanded: boolean
}>`
    width: 240px;
    height: 100%;
    display: flex;
    flex-direction: column;
    background: ${props => props.$token.colorBgContainer};
    opacity: ${props => props.$expanded ? 1 : 0};
    transition: opacity 0.2s ease;
    pointer-events: ${props => props.$expanded ? 'auto' : 'none'};
`

// 弹性占位
const Spacer = styled.div`
    flex: 1;
`

/**
 * 侧边栏主组件
 * 桌面端 240px 宽侧边栏，包含 Logo、导航、会话列表、底部操作
 * 收起时 width 动画过渡到 0px，内容不被挤压只被裁剪
 */
export function AppSidebar() {
    const { token } = useToken()
    const isMobile = useIsMobile()
    const sidebarExpanded = useUiStore((s) => s.sidebarExpanded)
    // WCO 模式下 Logo + 收起按钮已上移到 WcoTitleBar，SidebarHeader 不再渲染
    const isWco = useWco()

    // 移动端不渲染（使用 Drawer）
    if (isMobile) {
        return null
    }

    return (
        <SidebarContainer $token={token} $expanded={sidebarExpanded}>
            <SidebarInner $token={token} $expanded={sidebarExpanded}>
                {!isWco && <SidebarHeader />}
                <SidebarNav />
                <SidebarProjects />
                <Spacer />
                <SidebarFooter />
            </SidebarInner>
        </SidebarContainer>
    )
}
