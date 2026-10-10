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

import { describe, expect, test, afterAll, vi } from 'vitest'

// 宿主 shell 的 MOBI_API_URL（本机 daemon profile 指向 12222）会盖过配置默认的
// 2222，使断言环境敏感（2026-10-10 踩过，与 MOBI_MEMORY_ENGINE 同类坑）。
// 配置在模块顶层读 env，stub 必须先于动态 import 执行——静态 import 会在 hook
// 前完成求值
vi.stubEnv('MOBI_API_URL', '')
vi.stubEnv('MOBI_WEB_PORT', '')

const viteConfig = (await import('../vite.config')).default

afterAll(() => {
    vi.unstubAllEnvs()
})

describe('Vite dev terminal 配置', () => {
    test('向 dev 客户端注入 Hub URL，terminal 可绕过 Bun 下失效的 Vite WS tunnel', () => {
        expect(viteConfig.define).toMatchObject({
            __MOBI_HUB_URL__: JSON.stringify('http://localhost:2222'),
        })
    })

    test('不配置无调用方的 /socket.io WebSocket proxy', () => {
        expect(viteConfig.server?.proxy?.['/socket.io']).toBeUndefined()
    })
})
