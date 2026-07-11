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

import { vi } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// __MOBI_VERSION__ 由 vite 构建期从 cli package.json 注入（见 vite.config.ts），
// 但 vitest 用独立 config 不走 define，这里补全局 stub，同源读取避免写死
const mobiVersion = (
    JSON.parse(readFileSync(resolve(__dirname, '../../cli/package.json'), 'utf-8')) as {
        version: string
    }
).version
vi.stubGlobal('__MOBI_VERSION__', mobiVersion)

// jsdom 不实现 window.matchMedia，为使用 useMediaQuery 的组件提供 mock
Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
    })),
})

// jsdom 不实现 window.Notification（浏览器原生通知 API）。
// antd/antdx 的 notification 组件检测它，缺失时发 "Notification API is not supported" 警告。
// 补最小 stub：静态 permission 默认 denied（安全默认，避免测试误判已授权）。
// configurable:true 让测试可用 vi.stubGlobal('Notification', ...) 覆盖。
Object.defineProperty(window, 'Notification', {
    writable: true,
    configurable: true,
    value: class NotificationStub {
        static permission: NotificationPermission = 'denied'
        static requestPermission = vi.fn(async (): Promise<NotificationPermission> => 'denied')
        static maxActions = 0
        close = vi.fn()
        constructor(_title: string, _options?: NotificationOptions) {}
    },
})
