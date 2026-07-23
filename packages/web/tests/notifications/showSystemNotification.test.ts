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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { showSystemNotification } from '@/core/notifications'

describe('showSystemNotification', () => {
    const nav = navigator as { serviceWorker?: unknown } & typeof navigator
    let originalSW: unknown

    beforeEach(() => {
        originalSW = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker')?.value
    })

    afterEach(() => {
        Object.defineProperty(nav, 'serviceWorker', {
            value: originalSW,
            configurable: true,
        })
    })

    function mockServiceWorker(ready: Promise<unknown>): void {
        Object.defineProperty(nav, 'serviceWorker', {
            value: { ready },
            configurable: true,
        })
    }

    it('ready 就绪 → 调 registration.showNotification 透传 title/body/icon/tag/data，返回 true', async () => {
        const showNotification = vi.fn().mockResolvedValue(undefined)
        mockServiceWorker(Promise.resolve({ showNotification }))

        const ok = await showSystemNotification({
            title: 'T',
            body: 'B',
            icon: '/i.png',
            tag: 't1',
            renotify: true,
            data: { url: '/x' },
        })

        expect(ok).toBe(true)
        expect(showNotification).toHaveBeenCalledWith('T', {
            body: 'B',
            icon: '/i.png',
            tag: 't1',
            renotify: true,
            data: { url: '/x' },
        })
    })

    it('ready reject（SW 未注册/孤儿）→ 返回 false，调用方降级', async () => {
        mockServiceWorker(Promise.reject(new Error('no sw')))
        const ok = await showSystemNotification({ title: 'T' })
        expect(ok).toBe(false)
    })

    it('showNotification reject（权限被拒等）→ 返回 false', async () => {
        const showNotification = vi.fn().mockRejectedValue(new Error('denied'))
        mockServiceWorker(Promise.resolve({ showNotification }))
        const ok = await showSystemNotification({ title: 'T' })
        expect(ok).toBe(false)
    })

    it('可选字段缺省时 showNotification 收到 undefined（不报错）', async () => {
        const showNotification = vi.fn().mockResolvedValue(undefined)
        mockServiceWorker(Promise.resolve({ showNotification }))
        const ok = await showSystemNotification({ title: '仅标题' })
        expect(ok).toBe(true)
        expect(showNotification).toHaveBeenCalledWith('仅标题', {
            body: undefined,
            icon: undefined,
            tag: undefined,
            renotify: undefined,
            data: undefined,
        })
    })
})
