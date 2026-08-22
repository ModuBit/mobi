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
import { resolve } from 'path'
import { configure } from '@testing-library/react'
import { readMobiVersion } from '../src/core/lib/version'

// waitFor/findBy 的 RTL 默认超时是 1s，且不吃 vitest 的 testTimeout——全量并发
// CPU 饱和时异步渲染 1s 内完不成即抛「Unable to find an element」（负载型 flaky
// 的残余来源）。全局放宽到 5s；真渲染不出来 5s 后照样失败暴露
configure({ asyncUtilTimeout: 5000 })

// __MOBI_VERSION__ 由 vite 构建期从 cli package.json 注入（见 vite.config.ts），
// 但 vitest 用独立 config 不走 define，这里补全局 stub，同源读取避免写死
vi.stubGlobal('__MOBI_VERSION__', readMobiVersion(resolve(__dirname, '../../cli/package.json')))

// jsdom 不实现 window.localStorage（Node 22+ 的 localStorage 是实验性的，需 --localstorage-file 才启用；
// jsdom 4.x 也不暴露 window.localStorage）。诊断埋点（diag）依赖它做刷新后现场保留，测试补最小内存实现。
// 用 getter 挂在 window 上，vitest 环境自动生效，浏览器环境（真 localStorage）不受影响。
class LocalStorageStub implements Storage {
    private store = new Map<string, string>()
    get length(): number {
        return this.store.size
    }
    clear(): void {
        this.store.clear()
    }
    getItem(key: string): string | null {
        return this.store.get(key) ?? null
    }
    key(index: number): string | null {
        return [...this.store.keys()][index] ?? null
    }
    removeItem(key: string): void {
        this.store.delete(key)
    }
    setItem(key: string, value: string): void {
        this.store.set(key, String(value))
    }
}
if (typeof window !== 'undefined' && !window.localStorage) {
    Object.defineProperty(window, 'localStorage', {
        writable: true,
        configurable: true,
        value: new LocalStorageStub(),
    })
}

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
