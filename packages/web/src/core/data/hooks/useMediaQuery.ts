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

import { useState, useEffect } from 'react'

// Ant Design 断点
export const BREAKPOINTS = {
    xs: 576,
    sm: 576,
    md: 768,
    lg: 992,
    xl: 1200,
    xxl: 1600,
} as const

/**
 * 响应式媒体查询 Hook
 * @param query CSS 媒体查询字符串
 * @returns 是否匹配
 */
export function useMediaQuery(query: string): boolean {
    const [matches, setMatches] = useState(() => {
        if (typeof window === 'undefined') return false
        return window.matchMedia(query).matches
    })

    useEffect(() => {
        const mediaQuery = window.matchMedia(query)

        // 监听变化
        const handler = (event: MediaQueryListEvent) => {
            setMatches(event.matches)
        }

        mediaQuery.addEventListener('change', handler)
        return () => mediaQuery.removeEventListener('change', handler)
    }, [query])

    return matches
}

/**
 * 是否为移动端（宽度 < 768px）
 */
export function useIsMobile(): boolean {
    return !useMediaQuery(`(min-width: ${BREAKPOINTS.md}px)`)
}

/**
 * 是否为桌面端（宽度 >= 768px）
 */
export function useIsDesktop(): boolean {
    return useMediaQuery(`(min-width: ${BREAKPOINTS.md}px)`)
}
