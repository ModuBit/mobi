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
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'
import { ConfigProvider, App as AntdApp } from 'antd'
import { HelmetProvider } from 'react-helmet-async'
import { LoginPage } from '@/pages/LoginPage'

// —— mock axios：LoginPage 使用默认导出，调用 axios.post / axios.isAxiosError ——
vi.mock('axios', () => ({
    default: {
        post: vi.fn(),
        isAxiosError: vi.fn(() => false),
    },
}))
import axios, { type AxiosResponse } from 'axios'

// —— mock Router：LoginPage 调用 navigate({ to: '/' })，故 useNavigate 返回 (opts) => void ——
const mockNavigate = vi.fn()
vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => mockNavigate,
}))

// —— mock authStore：useAuthStore() 返回 { setAuthenticated } ——
const setAuthenticated = vi.fn()
vi.mock('@/core/data/stores/authStore', () => ({
    useAuthStore: () => ({ setAuthenticated }),
}))

// —— mock useThemeLocaleToggle：返回 resolvedTheme / locale / toggleTheme / toggleLocale ——
vi.mock('@/components/layout/useThemeLocaleToggle', () => ({
    useThemeLocaleToggle: () => ({
        resolvedTheme: 'light',
        locale: 'zh',
        toggleTheme: vi.fn(),
        toggleLocale: vi.fn(),
    }),
}))

// —— mock i18next：直返 key，便于按 key 定位元素 ——
vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (k: string) => k }),
}))

// —— 静态化 Logo 组件，避免动画/图片干扰 DOM 断言 ——
vi.mock('@/components/layout/Logo', () => ({ Logo: () => null }))
vi.mock('@/components/layout/AnimateLogo', () => ({ AnimateLogo: () => null }))

const wrapper = ({ children }: { children: ReactNode }) => (
    <HelmetProvider>
        <ConfigProvider>
            <AntdApp>{children}</AntdApp>
        </ConfigProvider>
    </HelmetProvider>
)

describe('LoginPage', () => {
    beforeEach(() => vi.clearAllMocks())
    afterEach(() => cleanup())

    it('提交 token 成功时置 authenticated 并跳转首页', async () => {
        vi.mocked(axios.post).mockResolvedValueOnce({
            status: 200,
            data: {},
        } as unknown as AxiosResponse)

        render(<LoginPage />, { wrapper })

        // placeholder 由 t('login.tokenPlaceholder') 直返
        const input = screen.getByPlaceholderText('login.tokenPlaceholder')
        fireEvent.change(input, { target: { value: 'my-token' } })
        fireEvent.click(screen.getByRole('button', { name: 'login.connect' }))

        await waitFor(() => {
            expect(axios.post).toHaveBeenCalledWith(
                expect.stringContaining('/api/auth'),
                { accessToken: 'my-token' },
                expect.objectContaining({ withCredentials: true }),
            )
        })
        // 登录态真源为 httpOnly cookie，前端仅置 authenticated 驱动路由
        expect(setAuthenticated).toHaveBeenCalledWith(true)
        expect(mockNavigate).toHaveBeenCalledWith({ to: '/' })
    })

    it('token 字段以 password 类型渲染（保留密码管理器语义）', () => {
        render(<LoginPage />, { wrapper })
        const input = screen.getByPlaceholderText('login.tokenPlaceholder')
        expect(input).toHaveAttribute('type', 'password')
    })
})
