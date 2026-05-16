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

/** 将颜色转为低透明度版本 */
function dimColor(color: string, alpha: number): string {
    if (color.startsWith('#') && (color.length === 7 || color.length === 4)) {
        const hex = color.replace('#', '')
        const expanded = hex.length === 3
            ? hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2]
            : hex
        const r = parseInt(expanded.substring(0, 2), 16)
        const g = parseInt(expanded.substring(2, 4), 16)
        const b = parseInt(expanded.substring(4, 6), 16)
        return `rgba(${r}, ${g}, ${b}, ${alpha})`
    }
    return color
}

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

    const color = textColor ?? token.colorText
    const highlight = color
    const base = dimColor(color, 0.8)

    return (
        <BlinkSpan
            className={className}
            style={style}
            $base={base}
            $highlight={highlight}
            $duration={duration}
        >
            {children}
        </BlinkSpan>
    )
}

const BlinkSpan = styled.span<{ $base: string; $highlight: string; $duration: number }>`
    background-clip: text;
    -webkit-background-clip: text;
    color: ${p => p.$base};
    background-image: linear-gradient(90deg, transparent, ${p => p.$highlight}, transparent);
    background-size: 50%;
    background-repeat: no-repeat;
    animation: ${blinkSweep} ${p => p.$duration}s linear infinite;
`
