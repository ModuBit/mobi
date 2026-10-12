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

/**
 * ThemeProvider 主题通道规格（shadcn 底座票 02，含 pending #113 回归）：
 * - data-theme / .dark class / shadcn 变量注入 / antd algorithm 四通道由 resolveTheme
 *   单源驱动（同一 effect），system 档按系统偏好解析而非恒落 light；
 * - data-theme 落解析后档位（light/dark），highlight.css 的 [data-theme='dark'] 在
 *   system+深色系统下生效。
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { ThemeProvider } from '@/core/config/theme/ThemeProvider'
import { useUiStore } from '@/core/data/stores/uiStore'
import { SHADCN_TOKENS_STYLE_ID } from '@/core/config/theme/cssVars'

/** 覆写 setup.ts 的默认 matchMedia 桩（matches:false），模拟系统主题偏好 */
function stubSystemTheme(dark: boolean) {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        matches: dark && query.includes('dark'),
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
    }))
}

function renderProvider() {
    return render(
        <ThemeProvider>
            <div>child</div>
        </ThemeProvider>,
    )
}

afterEach(() => {
    cleanup()
    document.getElementById(SHADCN_TOKENS_STYLE_ID)?.remove()
    document.documentElement.classList.remove('dark')
    document.documentElement.removeAttribute('data-theme')
})

describe('ThemeProvider 主题四通道单源', () => {
    it("theme='dark'：.dark class + data-theme=dark + 变量注入为暗档", () => {
        useUiStore.setState({ theme: 'dark' })
        renderProvider()
        expect(document.documentElement.classList.contains('dark')).toBe(true)
        expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
        expect(document.getElementById(SHADCN_TOKENS_STYLE_ID)?.textContent).toContain('--background: #141413')
    })

    it("theme='light'：无 .dark class + data-theme=light + 变量注入为亮档", () => {
        useUiStore.setState({ theme: 'light' })
        renderProvider()
        expect(document.documentElement.classList.contains('dark')).toBe(false)
        expect(document.documentElement.getAttribute('data-theme')).toBe('light')
        expect(document.getElementById(SHADCN_TOKENS_STYLE_ID)?.textContent).toContain('--background: #faf9f5')
    })

    it("theme='system' + 系统深色：解析为 dark（回归 pending #113，现行为恒 light 为红）", () => {
        stubSystemTheme(true)
        useUiStore.setState({ theme: 'system' })
        renderProvider()
        expect(document.documentElement.classList.contains('dark')).toBe(true)
        expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
        expect(document.getElementById(SHADCN_TOKENS_STYLE_ID)?.textContent).toContain('--background: #141413')
    })

    it("theme='system' + 系统浅色：解析为 light", () => {
        stubSystemTheme(false)
        useUiStore.setState({ theme: 'system' })
        renderProvider()
        expect(document.documentElement.classList.contains('dark')).toBe(false)
        expect(document.documentElement.getAttribute('data-theme')).toBe('light')
        expect(document.getElementById(SHADCN_TOKENS_STYLE_ID)?.textContent).toContain('--background: #faf9f5')
    })
})
