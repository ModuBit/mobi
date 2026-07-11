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
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

// t 直接回传 key，便于用 key 片段断言
vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (k: string) => k }),
}))
vi.mock('@/components/layout/useThemeLocaleToggle', () => ({
    useThemeLocaleToggle: () => ({
        resolvedTheme: 'light',
        locale: 'zh',
        toggleTheme: vi.fn(),
        toggleLocale: vi.fn(),
    }),
}))

import { BootLogPanel } from '@/components/login/BootLogPanel'

function mockMatchMedia(matches: boolean) {
    return (query: string) => ({
        matches,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
    })
}

describe('BootLogPanel', () => {
    beforeEach(() => {
        // reduced-motion → 全显，简化断言
        vi.stubGlobal('matchMedia', mockMatchMedia(true))
    })

    it('渲染 banner（MOBI 字标）与版权', () => {
        const { container } = render(<BootLogPanel />)
        // Panel 基础 display:none（仅 @media (min-width:1024px) 才显示），
        // jsdom 不评估 CSS 媒体查询，Panel 子树被排除出 a11y 树，
        // getByRole 需 hidden:true 才能命中 display:none 子树内的 svg
        expect(
            screen.getByRole('img', { name: 'Mobi', hidden: true }),
        ).toBeInTheDocument()
        // 用 textContent 断言，避免 getByText 正则命中多个祖先容器
        expect(container.textContent ?? '').toMatch(/©.*mobi/)
    })

    it('reduced-motion 下所有日志行立即可见', () => {
        const { container } = render(<BootLogPanel />)
        // reduced-motion → visibleCount = 全部；用 textContent 断言，
        // 避免 getByText 正则命中多个祖先（Lines/Panel 聚合文本同样含各 key）
        const text = container.textContent ?? ''
        expect(text).toContain('feature1Title')
        expect(text).toContain('feature2Title')
        expect(text).toContain('feature3Title')
        expect(text).toContain('awaiting connection')
    })
})
