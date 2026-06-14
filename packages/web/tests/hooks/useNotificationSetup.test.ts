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

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// mock client 的 useMobiApi —— 接收任意参数（包括 token），返回带 push 的 API
// mock 返回结构与真实 axios 一致：AxiosResponse.data 才是 body
// 用合法 base64url 字符串作为 VAPID 公钥（hook 会调用 atob 解码）
const VAPID_KEY = 'BEl62iUYgUizxkuKYYMKAFo'
vi.mock('@/core/data/api/client', () => ({
    useMobiApi: () => ({
        push: {
            getVapidKey: () => Promise.resolve({ data: { publicKey: VAPID_KEY } }),
            subscribe: vi.fn().mockResolvedValue({}),
        },
    }),
}))

// mock authStore，避免真实 store 初始化
vi.mock('@/core/data/stores/authStore', () => ({
    useAuthStore: () => ({ token: 'test-token' }),
}))

import { useNotificationSetup } from '@/core/data/hooks/useNotificationSetup'

describe('useNotificationSetup', () => {
    beforeEach(() => {
        vi.restoreAllMocks()
    })

    it('enable: permission=default → requestPermission → granted → 订阅并上报', async () => {
        vi.stubGlobal('Notification', {
            permission: 'default',
            requestPermission: vi.fn().mockResolvedValue('granted'),
        })
        const subscribeMock = vi.fn().mockResolvedValue({
            endpoint: 'https://push.test/ep1',
            keys: { p256dh: 'p', auth: 'a' },
            toJSON: () => ({
                endpoint: 'https://push.test/ep1',
                keys: { p256dh: 'p', auth: 'a' },
                expirationTime: null,
            }),
        })
        vi.stubGlobal('navigator', {
            serviceWorker: {
                ready: Promise.resolve({ pushManager: { subscribe: subscribeMock } }),
            },
        })

        const { result } = renderHook(() => useNotificationSetup('ns1'))
        await act(async () => {
            await result.current.enable()
        })

        expect(subscribeMock).toHaveBeenCalledWith(
            expect.objectContaining({
                applicationServerKey: expect.any(Uint8Array),
                userVisibleOnly: true,
            }),
        )
    })

    it('enable: permission=denied → 不订阅（返回 denied）', async () => {
        vi.stubGlobal('Notification', {
            permission: 'denied',
            requestPermission: vi.fn(),
        })
        const subscribeMock = vi.fn()
        vi.stubGlobal('navigator', {
            serviceWorker: {
                ready: Promise.resolve({ pushManager: { subscribe: subscribeMock } }),
            },
        })

        const { result } = renderHook(() => useNotificationSetup('ns1'))
        let res: string | undefined
        await act(async () => {
            res = await result.current.enable()
        })

        expect(res).toBe('denied')
        expect(subscribeMock).not.toHaveBeenCalled()
    })

    it('enable: permission=granted → 不再请求权限，直接订阅（重新订阅场景）', async () => {
        vi.stubGlobal('Notification', {
            permission: 'granted',
            requestPermission: vi.fn(),
        })
        const subscribeMock = vi.fn().mockResolvedValue({
            endpoint: 'https://push.test/ep2',
            keys: { p256dh: 'p2', auth: 'a2' },
            toJSON: () => ({
                endpoint: 'https://push.test/ep2',
                keys: { p256dh: 'p2', auth: 'a2' },
                expirationTime: null,
            }),
        })
        vi.stubGlobal('navigator', {
            serviceWorker: {
                ready: Promise.resolve({ pushManager: { subscribe: subscribeMock } }),
            },
        })

        const { result } = renderHook(() => useNotificationSetup('ns1'))
        let res: string | undefined
        await act(async () => {
            res = await result.current.enable()
        })

        expect(res).toBe('granted')
        // 不应再次请求权限
        expect(Notification.requestPermission).not.toHaveBeenCalled()
        // 应直接订阅
        expect(subscribeMock).toHaveBeenCalledTimes(1)
    })
})
