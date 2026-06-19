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
 * Mobi Icon 组件 — 内联 SVG，支持 currentColor 继承父元素颜色，
 * 自动适配深浅主题。
 */

import type { CSSProperties } from 'react'

interface IconProps {
    /** 自定义类名 */
    className?: string
    /** 内联样式 */
    style?: CSSProperties
}

/**
 * Mobi Icon（方形），使用 currentColor 继承父元素颜色。
 * 父元素设置 `color` 即可控制图标颜色。
 */
export function Icon({ className, style }: IconProps) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 128 128"
            fill="none"
            role="img"
            aria-label="Mobi"
            className={className}
            style={style}
        >
            {/* Back */}
            <rect
                x="56"
                y="20"
                width="32"
                height="58"
                rx="16"
                fill="currentColor"
                opacity="0.10"
            />
            {/* Mid */}
            <rect
                x="50"
                y="15"
                width="32"
                height="58"
                rx="16"
                fill="currentColor"
                opacity="0.20"
            />
            {/* Front */}
            <rect
                x="44"
                y="10"
                width="32"
                height="58"
                rx="16"
                fill="currentColor"
            />
            {/* Reading Mark */}
            <circle
                cx="60"
                cy="94"
                r="10"
                fill="none"
                stroke="currentColor"
                strokeWidth="5"
            />
        </svg>
    )
}
