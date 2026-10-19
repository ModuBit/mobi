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
import { createMobiApi } from '@/core/data/api/client'

/**
 * 地图设置的非 React 读取通道：openui Map 组件在渲染器 chunk 里，
 * 不能假定外层有 QueryClient（预览/测试也可能是裸渲染），故用模块级
 * 短 TTL 缓存 + 与设置页同一 api client 取数（createMobiApi 是纯工厂，
 * 无 Provider 依赖）。设置页保存后调 invalidateMapSettingsCache。
 */

const CACHE_TTL_MS = 30_000

let cached: { at: number; value: MapSettingsView } | null = null
let pending: Promise<MapSettingsView | null> | null = null
/** 失效代际：invalidate 递增，在途请求 resolve 时代际不匹配则不回填缓存 */
let generation = 0

export async function loadMapSettings(): Promise<MapSettingsView | null> {
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value
    if (pending) return pending
    const gen = generation
    pending = (async (): Promise<MapSettingsView | null> => {
        try {
            const data = (await createMobiApi().map.get()).data
            if (!data || !('settings' in data) || !data.settings) return null
            // invalidate 发生在本请求在途期间：旧配置不得回填（TTL 内持续按旧档位渲染）
            if (gen === generation) cached = { at: Date.now(), value: data.settings }
            return data.settings
        } catch {
            return null
        } finally {
            pending = null
        }
    })()
    return pending
}

/** 设置页保存后调用：下一次 Map 渲染重新取配置（含作废在途请求的回填资格） */
export function invalidateMapSettingsCache(): void {
    generation++
    cached = null
}
