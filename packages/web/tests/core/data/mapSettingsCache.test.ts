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
 * mapSettingsCache 竞态规格（2026-10-19 code-review 实锤）：
 * invalidate 不作废在途请求时，先于保存发起的 load 会在 resolve 后用旧配置
 * 回填 cached，TTL 30s 内 Map 持续按旧档位渲染。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const holder = vi.hoisted(() => ({
    /** 手动放行的响应（deferred）：resolve 前 loadMapSettings 挂起在途 */
    resolve: null as ((value: { data: { settings?: unknown } | { error: string } }) => void) | null,
}))
vi.mock('@/core/data/api/client', () => ({
    createMobiApi: () => ({
        map: {
            get: () => new Promise((resolve) => { holder.resolve = resolve }),
        },
    }),
}))

const { loadMapSettings, invalidateMapSettingsCache } = await import('@/core/data/mapSettingsCache')

beforeEach(() => {
    invalidateMapSettingsCache()
    holder.resolve = null
})

afterEach(() => {
    vi.clearAllMocks()
})

describe('loadMapSettings 缓存与失效', () => {
    it('invalidate 作废在途请求：保存后 resolve 的旧配置不得回填缓存（30s 内不得按旧档位渲染）', async () => {
        const oldSettings = { mode: 'none', webServiceKeySet: false }
        const newSettings = { mode: 'static', webServiceKeySet: true }

        // 1) 聊天页 Map 先发起 load（在途）
        const first = loadMapSettings()
        // 2) 用户保存设置 → onSuccess invalidate（cached 已清，但在途请求还挂着）
        invalidateMapSettingsCache()
        // 3) 在途请求用「保存前」的旧配置 resolve
        holder.resolve!({ data: { settings: oldSettings } })
        expect(await first).toEqual(oldSettings)
        // 4) 下一次 load 必须重新取数（旧配置没被回填），拿到新配置
        const second = loadMapSettings()
        holder.resolve!({ data: { settings: newSettings } })
        expect(await second).toEqual(newSettings)
    })

    it('正常路径：resolve 后 TTL 内命中缓存（不再发请求）', async () => {
        const settings = { mode: 'static', webServiceKeySet: true }
        const first = loadMapSettings()
        holder.resolve!({ data: { settings } })
        expect(await first).toEqual(settings)
        // 缓存命中：holder.resolve 不再被调用，仍返回同一份
        expect(await loadMapSettings()).toEqual(settings)
    })
})
