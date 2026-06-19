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
 * Mobi Logo 组件 — 内联 SVG，支持 currentColor 继承父元素颜色，
 * 自动适配深浅主题。
 */

import type { CSSProperties } from 'react'

interface LogoProps {
    /** 自定义类名 */
    className?: string
    /** 内联样式 */
    style?: CSSProperties
}

/**
 * Mobi Logo（方形），使用 currentColor 继承父元素颜色。
 * 父元素设置 `color` 即可控制 Logo 颜色。
 */
export function Logo({ className, style }: LogoProps) {
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
            {/* 后层 Shadow */}
            <rect
                x="57"
                y="17"
                width="29"
                height="78"
                rx="15"
                fill="currentColor"
                opacity="0.08"
            />
            {/* 中层 Shadow */}
            <rect
                x="50"
                y="11"
                width="29"
                height="78"
                rx="15"
                fill="currentColor"
                opacity="0.16"
            />
            {/* 主体 */}
            <rect
                x="43"
                y="5"
                width="29"
                height="78"
                rx="15"
                fill="currentColor"
            />
            {/* 空心墨点 */}
            <circle
                cx="57.5"
                cy="114"
                r="9"
                stroke="currentColor"
                strokeWidth="3.5"
                fill="none"
            />
        </svg>
    )
}
