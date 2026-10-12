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

/**
 * 检测当前是否运行在 PWA(独立窗口)环境。
 * 判据:`display-mode: standalone` 命中,或 iOS Safari 的 navigator.standalone。
 */
export function usePwaMode(): boolean {
    const [isPwa, setIsPwa] = useState(() => checkPwaMode())

    useEffect(() => {
        const mql = window.matchMedia('(display-mode: standalone)')
        const handler = () => setIsPwa(checkPwaMode())
        mql.addEventListener('change', handler)
        return () => mql.removeEventListener('change', handler)
    }, [])

    return isPwa
}

function checkPwaMode(): boolean {
    if (typeof window === 'undefined') return false
    if (window.matchMedia('(display-mode: standalone)').matches) return true
    // iOS Safari
    const nav = navigator as Navigator & { standalone?: boolean }
    return Boolean(nav.standalone)
}
