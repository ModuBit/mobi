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
import type { ReactNode } from 'react'
import styled from '@emotion/styled'

const { useToken } = antTheme

const SidebarContainer = styled.div<{ $token: ReturnType<typeof useToken>['token'] }>`
    width: 300px;
    height: 100vh;
    background: ${props => props.$token.colorBgContainer};
    border-right: 1px solid ${props => props.$token.colorBorder};
    display: flex;
    flex-direction: column;
    overflow: hidden;

    @media (max-width: 767px) {
        display: none;
    }
`

interface ContentSidebarProps {
    children: ReactNode
}

export function ContentSidebar({ children }: ContentSidebarProps) {
    const { token } = useToken()

    return (
        <SidebarContainer $token={token}>
            {children}
        </SidebarContainer>
    )
}
