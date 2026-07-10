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

import { describe, expect, test } from 'vitest'
import viteConfig from '../vite.config'

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
