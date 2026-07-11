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
 * Mobi Logo 组件 — 内联裸 "m" 标记（透明底），颜色跟随 app 主题（uiStore.theme）。
 * 装饰性标记：组合处由字标（MobiWordmark/MobiLockup）承载可访问名，此处 aria-hidden。
 * 尺寸由父元素通过 width/height 控制。
 */

import type { CSSProperties } from 'react'
import { useUiStore } from '@/core/data/stores/uiStore'
import { MOBI_MARK_PATH } from './brandPaths'

interface LogoProps {
    /** 自定义类名 */
    className?: string
    /** 内联样式 */
    style?: CSSProperties
}

export function Logo({ className, style }: LogoProps) {
    // 跟随 app 主题取标记色（与文本色一致），浅色 #141413 / 深色 #faf9f5
    const isDark = useUiStore((s) => s.theme === 'dark')
    const color = isDark ? '#faf9f5' : '#141413'

    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 250 250"
            className={className}
            style={style}
            aria-hidden="true"
        >
            <path fill={color} d={MOBI_MARK_PATH} />
            <path fill={color} transform="translate(250,0) scale(-1,1)" d={MOBI_MARK_PATH} />
            <circle fill={color} cx="125" cy="161" r="16.5" />
        </svg>
    )
}
