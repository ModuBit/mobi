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

import { keyframes } from '@emotion/react'
import styled from '@emotion/styled'
import { theme } from 'antd'

/** 从左到右循环扫光 */
const blinkSweep = keyframes`
  0% { background-position-x: -200%; }
  100% { background-position-x: 200%; }
`

export interface BlinkTextProps {
    /** 是否启用闪烁 */
    blinking: boolean
    /** 文字颜色，默认使用 antd token.colorText */
    color?: string
    /** 动画周期（秒），默认 1.5s */
    duration?: number
    children: React.ReactNode
    className?: string
    style?: React.CSSProperties
}

/**
 * 文字扫光闪烁组件（基于 antd-x Think blinkMotion）
 *
 * 文字始终可见（dim 底色），高亮色从左到右循环扫过形成闪烁。
 * 适用于浅色/深色主题。
 */
export function BlinkText({
    blinking,
    color: textColor,
    duration = 1.5,
    children,
    className,
    style,
}: BlinkTextProps) {
    const { token } = theme.useToken()

    if (!blinking) {
        return <span className={className} style={style}>{children}</span>
    }

    const highlight = textColor ?? token.colorText

    return (
        <BlinkSpan
            className={className}
            style={style}
            $highlight={highlight}
            $duration={duration}
        >
            {children}
        </BlinkSpan>
    )
}

const BlinkSpan = styled.span<{ $highlight: string; $duration: number }>`
    background-clip: text;
    -webkit-background-clip: text;
    color: color-mix(in srgb, ${p => p.$highlight} 70%, transparent);
    background-image: linear-gradient(90deg, transparent, ${p => p.$highlight}, transparent);
    background-size: 50%;
    background-repeat: no-repeat;
    animation: ${blinkSweep} ${p => p.$duration}s linear infinite;
`
