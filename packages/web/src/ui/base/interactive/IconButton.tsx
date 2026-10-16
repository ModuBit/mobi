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
import { AppTooltip } from '@/ui/base/interactive/AppTooltip'
import type { ReactNode, ButtonHTMLAttributes } from 'react'
import styled from '@emotion/styled'

const { useToken } = antTheme

const StyledButton = styled.button<{
    $active?: boolean
    $circle?: boolean
    $danger?: boolean
    $variant: 'ghost' | 'default'
    $token: ReturnType<typeof useToken>['token']
    $size: number
}>`
    width: ${props => props.$size}px;
    height: ${props => props.$size}px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: ${props => props.$variant === 'default' ? `1px solid ${props.$token.colorBorder}` : 'none'};
    background: ${props => {
        if (props.$active) return props.$token.colorPrimaryBg
        // default 档（antd default 等价）：白底实底，供浮在内容上的悬浮钮（如滚到底 FAB）与内容分层
        if (props.$variant === 'default') return props.$token.colorBgContainer
        return 'transparent'
    }};
    // danger 语义色优先（原 antd text danger 红字），不被 active/hover 主色盖过语义
    color: ${props => {
        if (props.$danger && !props.$active) return props.$token.colorError
        if (props.$active) return props.$token.colorPrimary
        return props.$variant === 'default' ? props.$token.colorText : props.$token.colorTextSecondary
    }};
    border-radius: ${props => props.$circle ? '50%' : 'var(--radius-icon)'};
    cursor: ${props => props.disabled ? 'not-allowed' : 'pointer'};
    opacity: ${props => props.disabled ? 0.4 : 1};
    transition: all 0.2s;

    &:hover:not(:disabled) {
        // hover 用悬浮高亮淡档，active（$active）保留 colorPrimaryBg——hover ≠ 选中（DESIGN.md Hover 高亮章）
        background: ${props => props.$token.colorBgTextHover};
        color: ${props => props.$danger ? props.$token.colorError : props.$token.colorPrimary};
    }
`

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    icon: ReactNode
    active?: boolean
    size?: number
    tooltip?: string
    tooltipPlacement?: 'top' | 'left' | 'right' | 'bottom'
    /** 圆形形态（原 antd shape="circle"）：FAB、悬浮 icon 钮 */
    circle?: boolean
    /** 危险语义色（原 antd danger）：红图标，hover 保持红 */
    danger?: boolean
    /** ghost = 透明底（默认，嵌在工具条里）；default = 白底描边（浮在内容上需与背景分层） */
    variant?: 'ghost' | 'default'
}

export function IconButton({
    icon,
    active,
    size = 36,
    tooltip,
    tooltipPlacement = 'top',
    circle,
    danger,
    variant = 'ghost',
    'aria-label': ariaLabel,
    ...props
}: IconButtonProps) {
    const { token } = useToken()

    const button = (
        <StyledButton
            $active={active}
            $circle={circle}
            $danger={danger}
            $variant={variant}
            $token={token}
            $size={size}
            // 图标按钮无可访问名称（SVG 不贡献名称）；tooltip 与视觉语义同源，
            // 未显式传 aria-label 时以它兜底，保证读屏可辨识
            aria-label={ariaLabel ?? tooltip}
            {...props}
        >
            {icon}
        </StyledButton>
    )

    if (tooltip) {
        return (
            <AppTooltip title={tooltip} placement={tooltipPlacement}>
                {button}
            </AppTooltip>
        )
    }

    return button
}
