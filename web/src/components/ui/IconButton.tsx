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
import type { ReactNode, ButtonHTMLAttributes } from 'react'
import styled from '@emotion/styled'

const { useToken } = antTheme

const StyledButton = styled.button<{
    $active?: boolean
    $token: ReturnType<typeof useToken>['token']
    $size: number
}>`
    width: ${props => props.$size}px;
    height: ${props => props.$size}px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: ${props => props.$active ? props.$token.colorPrimaryBg : 'transparent'};
    color: ${props => props.$active ? props.$token.colorPrimary : props.$token.colorTextSecondary};
    border-radius: 6px;
    cursor: ${props => props.disabled ? 'not-allowed' : 'pointer'};
    opacity: ${props => props.disabled ? 0.4 : 1};
    transition: all 0.2s;

    &:hover:not(:disabled) {
        background: ${props => props.$token.colorPrimaryBg};
        color: ${props => props.$token.colorPrimary};
    }
`

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    icon: ReactNode
    active?: boolean
    size?: number
    tooltip?: string
    tooltipPlacement?: 'top' | 'left' | 'right' | 'bottom'
}

export function IconButton({
    icon,
    active,
    size = 36,
    tooltip,
    tooltipPlacement = 'top',
    ...props
}: IconButtonProps) {
    const { token } = useToken()

    const button = (
        <StyledButton
            $active={active}
            $token={token}
            $size={size}
            {...props}
        >
            {icon}
        </StyledButton>
    )

    if (tooltip) {
        return (
            <Tooltip title={tooltip} placement={tooltipPlacement}>
                {button}
            </Tooltip>
        )
    }

    return button
}
