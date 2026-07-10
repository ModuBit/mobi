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

import { useEffect, useState } from 'react'
import { useUiStore, resolveTheme } from '@/core/data/stores/uiStore'

/**
 * 当前是否为暗色主题。
 *
 * 订阅 uiStore.theme：light/dark 直接返回；system 模式下解析 OS 偏好，
 * 并监听 prefers-color-scheme 变化实时响应（uiStore 仅存 'system' 字符串，
 * OS 切换不会触发 store 更新，故在此补 matchMedia 监听）。
 */
export function useIsDark(): boolean {
    const theme = useUiStore((s) => s.theme)
    const [isDark, setIsDark] = useState(() => resolveTheme(theme) === 'dark')

    useEffect(() => {
        const apply = () => setIsDark(resolveTheme(theme) === 'dark')
        apply()
        if (theme !== 'system') return
        const mql = window.matchMedia('(prefers-color-scheme: dark)')
        const handler = () => apply()
        mql.addEventListener('change', handler)
        return () => mql.removeEventListener('change', handler)
    }, [theme])

    return isDark
}
