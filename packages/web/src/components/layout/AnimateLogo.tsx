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

/**
 * Mobi 动画 Logo 组件 — 内联裸 "m" 标记 + 构建/墨点脉冲/浮动动画，颜色跟随 app 主题。
 * 动画用 emotion keyframes + styled（@keyframes 全局去重、类名作用域化，多实例不重复 <style>）。
 * 装饰性标记：组合处由字标承载可访问名，此处 aria-hidden。
 * 尺寸由父元素通过 width/height 控制。
 */

import type { CSSProperties } from 'react'
import styled from '@emotion/styled'
import { keyframes } from '@emotion/react'
import { useUiStore } from '@/core/data/stores/uiStore'
import { MOBI_MARK_PATH } from './brandPaths'

interface AnimateLogoProps {
    /** 自定义类名 */
    className?: string
    /** 内联样式 */
    style?: CSSProperties
}

/* ── keyframes（emotion 全局去重） ── */

const floatKf = keyframes`
    0%, 50%, 100% { transform: translateY(0); }
    25%           { transform: translateY(-3px); }
`

const buildKf = keyframes`
    from { opacity: 0; transform: translateY(20px) scaleY(.6); }
    to   { opacity: 1; transform: translateY(0)    scaleY(1); }
`

const dotAppearKf = keyframes`
    from { opacity: 0; transform: scale(.6); }
    to   { opacity: 1; transform: scale(1); }
`

const pulseKf = keyframes`
    0%, 40%, 100% { transform: scale(1); }
    20%           { transform: scale(1.15); }
`

/* ── 作用域样式（styled 生成哈希类名，不污染全局命名空间） ── */

/** 整组轻浮动 */
const LogoGroup = styled.g`
    transform-origin: center;
    animation: ${floatKf} 2800ms ease-in-out infinite;
    animation-delay: 1500ms;

    @media (prefers-reduced-motion: reduce) {
        animation: none;
    }
`

/** 双腿自下而上 build（scaleY 锚定底部） */
const Leg = styled.g`
    transform-box: fill-box;
    transform-origin: 50% 100%;
    opacity: 0;
    animation: ${buildKf} 800ms cubic-bezier(.22, 1, .36, 1) forwards;

    @media (prefers-reduced-motion: reduce) {
        animation: none;
        opacity: 1;
    }
`

/** 墨点：先入场，再循环脉冲 */
const Dot = styled.circle`
    transform-box: fill-box;
    transform-origin: center;
    opacity: 0;
    animation: ${dotAppearKf} 500ms ease forwards, ${pulseKf} 2800ms ease-in-out infinite;
    animation-delay: 900ms, 1500ms;

    @media (prefers-reduced-motion: reduce) {
        animation: none;
        opacity: 1;
    }
`

export function AnimateLogo({ className, style }: AnimateLogoProps) {
    const isDark = useUiStore((s) => s.theme === 'dark')
    const color = isDark ? '#faf9f5' : '#141413'

    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 250 250"
            className={className}
            style={{ ...style, color }}
            aria-hidden="true"
        >
            <LogoGroup fill="currentColor">
                {/* 左腿 */}
                <Leg>
                    <path d={MOBI_MARK_PATH} />
                </Leg>

                {/* 右腿（镜像需独立一层承载 transform 属性，避免被 CSS 动画覆盖） */}
                <g transform="translate(250,0) scale(-1,1)">
                    <Leg style={{ animationDelay: '250ms' }}>
                        <path d={MOBI_MARK_PATH} />
                    </Leg>
                </g>

                {/* 中心墨点 */}
                <Dot cx="125" cy="161" r="16.5" />
            </LogoGroup>
        </svg>
    )
}
