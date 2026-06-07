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

const { useToken } = antTheme

// 侧边栏容器
const SidebarContainer = styled.div<{ $token: ReturnType<typeof useToken>['token'] }>`
    width: 240px;
    flex-shrink: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    height: 100%;
    background: ${props => props.$token.colorBgContainer};
    border-right: 1px solid ${props => props.$token.colorBorder};
`

// 弹性占位
const Spacer = styled.div`
    flex: 1;
`

/**
 * 侧边栏主组件
 * 桌面端 240px 宽侧边栏，包含 Logo、导航、会话列表（后续）、底部操作
 */
export function AppSidebar() {
    const { token } = useToken()
    const isMobile = useIsMobile()
    const sidebarExpanded = useUiStore((s) => s.sidebarExpanded)

    // 移动端或侧边栏收起时不渲染
    if (isMobile || !sidebarExpanded) {
        return null
    }

    return (
        <SidebarContainer $token={token}>
            <SidebarHeader />
            <SidebarNav />
            <SidebarProjects />
            <Spacer />
            <SidebarFooter />
        </SidebarContainer>
    )
}
