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

import type { MapSettingsView } from '@mobi/shared'

/**
 * 地图设置的非 React 读取通道：openui Map 组件在渲染器 chunk 里，
 * 不能假定外层有 QueryClient（预览/测试也可能是裸渲染），故用模块级
 * 短 TTL 缓存 + 同源 fetch。设置页保存后调 invalidateMapSettingsCache。
 */

const CACHE_TTL_MS = 30_000

let cached: { at: number; value: MapSettingsView } | null = null
let pending: Promise<MapSettingsView | null> | null = null

export async function loadMapSettings(): Promise<MapSettingsView | null> {
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value
    if (pending) return pending
    pending = (async (): Promise<MapSettingsView | null> => {
        try {
            const res = await fetch('/api/map', { credentials: 'same-origin' })
            if (!res.ok) return null
            const data = (await res.json()) as { settings?: MapSettingsView }
            if (!data.settings) return null
            cached = { at: Date.now(), value: data.settings }
            return data.settings
        } catch {
            return null
        } finally {
            pending = null
        }
    })()
    return pending
}

/** 设置页保存后调用：下一次 Map 渲染重新取配置 */
export function invalidateMapSettingsCache(): void {
    cached = null
}
