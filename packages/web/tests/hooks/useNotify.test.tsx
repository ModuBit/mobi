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

// mock showSystemNotification（避免依赖真实 SW），用 hoisted 让 vi.mock 拿到引用
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

    it('已授权（permission=granted）→ 调 showSystemNotification（title/body/icon）', () => {
        vi.stubGlobal('Notification', { permission: 'granted' })
        const { result } = renderHook(() => useNotify(), { wrapper })
        result.current.success({ message: '标题', description: '正文' })
        expect(showSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                title: '标题',
                body: '正文',
                icon: '/favicon.ico',
            }),
        )
    })

    it('未授权（permission=default）→ 不调 showSystemNotification，走 antd 页面通知', () => {
        vi.stubGlobal('Notification', { permission: 'default' })
        const { result } = renderHook(() => useNotify(), { wrapper })
        result.current.success({ message: '标题' })
        expect(showSpy).not.toHaveBeenCalled()
        // 未授权走 antd 页面通知（notification 已 mock 为 spy）
        expect(notificationApi.success).toHaveBeenCalledWith(
            expect.objectContaining({ message: '标题' }),
        )
    })

    it('warning/error/info 同样在已授权时走 showSystemNotification', () => {
        vi.stubGlobal('Notification', { permission: 'granted' })
        const { result } = renderHook(() => useNotify(), { wrapper })
        result.current.warning({ message: 'w' })
        result.current.error({ message: 'e' })
        result.current.info({ message: 'i' })
        expect(showSpy).toHaveBeenCalledTimes(3)
    })

    it('destroy 透传不抛错', () => {
        const { result } = renderHook(() => useNotify(), { wrapper })
        expect(() => result.current.destroy('some-key')).not.toThrow()
        expect(notificationApi.destroy).toHaveBeenCalledWith('some-key')
    })
})
