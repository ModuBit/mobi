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
 * Mobi 字标 — 描边 "MOBI" 四字母。
 * 线条颜色默认 currentColor（继承父元素 color，可跟随主题），
 * 线宽随尺寸等比缩放（描边 "MOBI" 四字母）。
 */

import type { CSSProperties } from 'react'
import { MOBI_WORDMARK_PATHS } from './brandPaths'

interface MobiWordmarkProps {
    /** 高度。数字按 px 处理，也可传 '1em' / '24px' 等。默认 18 */
    size?: number | string
    /** 描边颜色。默认 'currentColor'（继承父元素 color，可跟随主题） */
    color?: string
    /** 描边屏幕线宽（non-scaling，不随尺寸变细）。默认 3，小尺寸下也有足够存在感 */
    strokeWidth?: number
    className?: string
    style?: CSSProperties
}

export function MobiWordmark({
    size = 18,
    color = 'currentColor',
    strokeWidth = 3,
    className,
    style,
}: MobiWordmarkProps) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="16 24 144 70"
            role="img"
            aria-label="Mobi"
            className={className}
            style={{ height: size, width: 'auto', ...style }}
        >
            <g
                fill="none"
                stroke={color}
                strokeWidth={strokeWidth}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
            >
                {MOBI_WORDMARK_PATHS.map((d, i) => (
                    <path key={i} d={d} />
                ))}
            </g>
        </svg>
    )
}
