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

import { useCallback, useEffect, useRef, useState } from 'react'
import {
    motion,
    useMotionValue,
    useAnimationFrame,
    useTransform,
} from 'motion/react'
import { theme } from 'antd'

export interface BlinkTextProps {
    /** 是否启用闪烁 */
    blinking: boolean
    /** 文字颜色，默认使用 antd token.colorText */
    color?: string
    /** 高亮光泽色，默认从底色自动衍生柔和高亮 */
    shineColor?: string
    /** 动画周期（秒），默认 2s */
    duration?: number
    children: React.ReactNode
    className?: string
    style?: React.CSSProperties
}

/**
 * 文字光泽闪烁组件（基于 ReactBits ShinyText）
 *
 * 当 blinking=true 时，高亮光泽从左到右循环扫过文字形成闪烁效果。
 * 当 blinking=false 时，渲染为普通文字。适用于浅色/深色主题。
 */
export function BlinkText({
    blinking,
    color: textColor,
    shineColor,
    duration = 2,
    children,
    className,
    style,
}: BlinkTextProps) {
    const { token } = theme.useToken()
    const [isPaused, setIsPaused] = useState(false)
    const progress = useMotionValue(0)
    const elapsedRef = useRef(0)
    const lastTimeRef = useRef<number | null>(null)

    const baseColor = textColor ?? token.colorText
    // 默认从底色混合 50% 白色，生成柔和自然的高亮；避免 antd dark mode 下 token 颜色错误
    const highlightColor = shineColor ?? `color-mix(in srgb, ${baseColor} 50%, #ffffff)`
    const animationDuration = duration * 1000

    useAnimationFrame(time => {
        if (!blinking || isPaused) {
            lastTimeRef.current = null
            return
        }

        if (lastTimeRef.current === null) {
            lastTimeRef.current = time
            return
        }

        const deltaTime = time - lastTimeRef.current
        lastTimeRef.current = time
        elapsedRef.current += deltaTime

        const cycleTime = elapsedRef.current % animationDuration
        const p = (cycleTime / animationDuration) * 100
        progress.set(p)
    })

    useEffect(() => {
        elapsedRef.current = 0
        progress.set(0)
    }, [blinking, progress])

    // 进度映射为背景位置：0% → 150%（右侧屏外），100% → -50%（左侧屏外）
    const backgroundPosition = useTransform(
        progress,
        p => `${150 - p * 2}% center`,
    )

    const handleMouseEnter = useCallback(() => {
        setIsPaused(true)
    }, [])

    const handleMouseLeave = useCallback(() => {
        setIsPaused(false)
    }, [])

    if (!blinking) {
        return (
            <span className={className} style={style}>
                {children}
            </span>
        )
    }

    const gradientStyle: React.CSSProperties = {
        ...style,
        display: 'inline-block',
        backgroundImage: `linear-gradient(120deg, ${baseColor} 0%, ${baseColor} 35%, ${highlightColor} 50%, ${baseColor} 65%, ${baseColor} 100%)`,
        backgroundSize: '200% auto',
        WebkitBackgroundClip: 'text',
        backgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
    }

    return (
        <motion.span
            className={className}
            style={{ ...gradientStyle, backgroundPosition }}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
        >
            {children}
        </motion.span>
    )
}
