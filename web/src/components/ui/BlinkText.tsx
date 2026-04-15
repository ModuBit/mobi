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

/** 扫光关键帧：背景渐变从左到右移动 */
const blinkSweep = keyframes`
  0% { background-position-x: -200%; }
  100% { background-position-x: 200%; }
`

export interface BlinkTextProps {
    /** 是否启用闪烁 */
    blinking: boolean
    /**
     * 高亮色（扫光颜色），默认使用 antd token.colorText
     * 渐变为 currentColor → highlightColor → currentColor
     */
    highlightColor?: string
    /** 动画周期（秒），默认 1.5 */
    duration?: number
    children: React.ReactNode
    className?: string
    style?: React.CSSProperties
}

/**
 * 文字扫光闪烁组件
 *
 * 在保持原有文字样式（字号、字体、颜色等）的基础上，添加渐变扫光效果。
 *
 * 原理：
 * 1. -webkit-text-fill-color: transparent 使文字填充透明
 * 2. background-clip: text 将背景裁剪到文字形状
 * 3. 渐变两端为 currentColor（继承原色），中间为高亮色
 * 4. 动画移动 backgroundPositionX，形成扫光效果
 *
 * 用法：
 * ```tsx
 * <BlinkText blinking={isLoading}>思考中...</BlinkText>
 * <BlinkText blinking={isActive} highlightColor="#fff" duration={2}>处理中</BlinkText>
 * ```
 */
export function BlinkText({
    blinking,
    highlightColor,
    duration = 1.5,
    children,
    className,
    style,
}: BlinkTextProps) {
    const { token } = theme.useToken()

    if (!blinking) {
        return <span className={className} style={style}>{children}</span>
    }

    return (
        <BlinkSpan
            className={className}
            style={style}
            $highlight={highlightColor ?? token.colorText}
            $duration={duration}
        >
            {children}
        </BlinkSpan>
    )
}

const BlinkSpan = styled.span<{ $highlight: string; $duration: number }>`
    -webkit-text-fill-color: transparent;
    background-clip: text;
    -webkit-background-clip: text;
    background-image: linear-gradient(90deg, currentColor, ${p => p.$highlight}, currentColor);
    background-size: 50%;
    background-repeat: no-repeat;
    animation: ${blinkSweep} ${p => p.$duration}s linear infinite;
`
