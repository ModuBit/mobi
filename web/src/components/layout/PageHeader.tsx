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

import type { ReactNode } from 'react'
import { Layout, theme as antTheme } from 'antd'
import styled from '@emotion/styled'

const { useToken } = antTheme

/**
 * 页面头部左侧区域
 */
export const HeaderLeft = styled.div`
    display: flex;
    align-items: center;
    gap: 12px;
`

/**
 * 页面头部右侧区域
 */
export const HeaderRight = styled.div`
    display: flex;
    align-items: center;
    gap: 8px;
`

const StyledHeader = styled(Layout.Header)<{ $token: ReturnType<typeof useToken>['token'] }>`
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 16px;
    height: auto;
    min-height: 48px;
    line-height: normal;
    background: ${props => props.$token.colorBgContainer} !important;
    border-bottom: 1px solid ${props => props.$token.colorBorder};
`

interface PageHeaderProps {
    left?: ReactNode
    right?: ReactNode
    children?: ReactNode
}

/**
 * 统一的页面头部组件
 *
 * 支持两种用法：
 * 1. left/right 属性：`<PageHeader left={...} right={...} />`
 * 2. 直接子元素：`<PageHeader>内容</PageHeader>`
 */
export function PageHeader({ left, right, children }: PageHeaderProps) {
    const { token } = useToken()

    if (left || right) {
        return (
            <StyledHeader $token={token}>
                <HeaderLeft>{left}</HeaderLeft>
                {right && <HeaderRight>{right}</HeaderRight>}
            </StyledHeader>
        )
    }

    return (
        <StyledHeader $token={token}>
            {children}
        </StyledHeader>
    )
}
