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

import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { ConfigProvider, App as AntdApp } from 'antd'
import type { ReactNode } from 'react'
import { useNotify } from '@/core/data/hooks/useNotify'

// useNotify 现在是纯页面 Toast 封装,不应再碰系统通知。
// 仍 mock showSystemNotification 以断言"绝不被调用"。
const showSpy = vi.hoisted(() => vi.fn().mockResolvedValue(true))
vi.mock('@/core/notifications', () => ({
    showSystemNotification: showSpy,
}))

// mock antd App.useApp 的 notification 为 spy：
// 真实 antd notification 实例会创建 duration 自动关闭定时器，在测试结束 jsdom
// 销毁后触发，访问失效 window → "window is not defined" unhandled error。
// 用 spy 避免真实实例，断言 dispatch 路由即可。
const notificationApi = vi.hoisted(() => ({
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    destroy: vi.fn(),
}))
vi.mock('antd', async (orig) => {
    const actual = await orig()
    return {
        ...actual,
        App: {
            ...actual.App,
            useApp: () => ({ notification: notificationApi }),
        },
    }
})

function wrapper({ children }: { children: ReactNode }) {
    return (
        <ConfigProvider>
            <AntdApp>{children}</AntdApp>
        </ConfigProvider>
    )
}

describe('useNotify', () => {
    afterEach(() => {
        vi.clearAllMocks()
        vi.unstubAllGlobals()
    })

    it('始终走 antd 页面通知,绝不调 showSystemNotification(已授权也不升级)', () => {
        // 即便已授权系统通知,useNotify 也不再隐式升级——
        // 系统通知由调用方显式调用,避免 success/info/断线等提示泛滥触发 Chrome 反垃圾。
        vi.stubGlobal('Notification', { permission: 'granted' })
        const { result } = renderHook(() => useNotify(), { wrapper })
        result.current.success({ message: '标题', description: '正文' })
        expect(showSpy).not.toHaveBeenCalled()
        expect(notificationApi.success).toHaveBeenCalledWith(
            expect.objectContaining({ message: '标题', description: '正文' }),
        )
    })

    it('未授权(default)同样走 antd 页面通知', () => {
        vi.stubGlobal('Notification', { permission: 'default' })
        const { result } = renderHook(() => useNotify(), { wrapper })
        result.current.success({ message: '标题' })
        expect(showSpy).not.toHaveBeenCalled()
        expect(notificationApi.success).toHaveBeenCalledWith(
            expect.objectContaining({ message: '标题' }),
        )
    })

    it('warning/error/info 均只走 antd 页面通知', () => {
        vi.stubGlobal('Notification', { permission: 'granted' })
        const { result } = renderHook(() => useNotify(), { wrapper })
        result.current.warning({ message: 'w', key: 'k1' })
        result.current.error({ message: 'e', key: 'k2' })
        result.current.info({ message: 'i', key: 'k3' })
        expect(showSpy).not.toHaveBeenCalled()
        expect(notificationApi.warning).toHaveBeenCalledWith(expect.objectContaining({ message: 'w', key: 'k1' }))
        expect(notificationApi.error).toHaveBeenCalledWith(expect.objectContaining({ message: 'e', key: 'k2' }))
        expect(notificationApi.info).toHaveBeenCalledWith(expect.objectContaining({ message: 'i', key: 'k3' }))
    })

    it('destroy 透传不抛错', () => {
        const { result } = renderHook(() => useNotify(), { wrapper })
        expect(() => result.current.destroy('some-key')).not.toThrow()
        expect(notificationApi.destroy).toHaveBeenCalledWith('some-key')
    })
})
