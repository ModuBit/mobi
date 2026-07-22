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

/** Window Controls Overlay 的最小可用接口（Chromium 桌面 PWA 提供） */
interface WindowControlsOverlay {
    visible: boolean
    addEventListener(type: 'geometrychange', listener: () => void): void
    removeEventListener(type: 'geometrychange', listener: () => void): void
}

type NavigatorWithWCO = Navigator & { windowControlsOverlay?: WindowControlsOverlay }

/**
 * 检测 Window Controls Overlay 是否可用且当前可见。
 *
 * WCO 是桌面端 Chromium PWA 专属特性（Chrome/Edge 105+）。
 * - 普通浏览器 / 移动端：navigator.windowControlsOverlay 不存在 → false
 * - standalone（WCO 不可用）：visible === false → false
 * - 全屏：visible 变 false → 自动降级
 *
 * 返回 true 时启用自定义标题栏；false 时一切走现有渲染路径（PC Web / 移动端不受影响）。
 */
export function useWindowControlsOverlay(): boolean {
    const [enabled, setEnabled] = useState(() => checkVisible())

    useEffect(() => {
        const wco = (navigator as NavigatorWithWCO).windowControlsOverlay
        if (!wco) return

        const update = () => setEnabled(checkVisible())
        wco.addEventListener('geometrychange', update)
        return () => {
            wco.removeEventListener('geometrychange', update)
        }
    }, [])

    return enabled
}

function checkVisible(): boolean {
    if (typeof navigator === 'undefined') return false
    const wco = (navigator as NavigatorWithWCO).windowControlsOverlay
    return Boolean(wco?.visible)
}
