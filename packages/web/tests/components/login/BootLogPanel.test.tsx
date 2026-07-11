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
// Logo 内部 useUiStore 的 import 链会触发 i18n 初始化副作用，与上面的
// react-i18next mock 冲突；mock 成静态 svg 切断链路（此处不验证 Logo 本体）
vi.mock('@/components/layout/Logo', () => ({
    Logo: () => <svg data-testid="mobi-logo" aria-hidden="true" />,
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

    it('渲染 hero：MOBI 字标 + neofetch 信息表 + 版权', () => {
        const { container } = render(<BootLogPanel />)
        // Panel 基础 display:none（仅 @media (min-width:1024px) 才显示），
        // jsdom 不评估 CSS 媒体查询，子树被排除出 a11y 树，需 hidden:true
        expect(
            screen.getByRole('img', { name: 'Mobi', hidden: true }),
        ).toBeInTheDocument()
        const text = container.textContent ?? ''
        expect(text).toContain('ready')
        expect(text).toContain('claude code')
        expect(text).toContain('any device')
        expect(text).toContain('100% local')
        expect(text).toContain('login.subtitle')
        expect(text).toMatch(/©.*mobi/)
    })

    it('渲染 boot log 启动序列 + 能力树 + online 指示', () => {
        const { container } = render(<BootLogPanel />)
        const text = container.textContent ?? ''
        // titlebar 在线指示
        expect(text).toContain('online')
        // boot log 启动序列（含 ok 标记）
        expect(text).toContain('initializing mobi daemon')
        expect(text).toContain('loading plugin registry')
        expect(text).toContain('mounting workspace')
        expect(text).toContain('establishing secure tunnel')
        expect(text).toContain('warming context cache')
        // 能力树：五大模块 + 状态
        expect(text).toContain('sessions')
        expect(text).toContain('devices')
        expect(text).toContain('terminal')
        expect(text).toContain('plugins')
        expect(text).toContain('files')
        expect(text).toContain('paired')
        expect(text).toContain('synced')
        // 历史命令行
        expect(text).toContain('mobi service start')
    })

    it('reduced-motion 下 feature + 状态行全部可见', () => {
        const { container } = render(<BootLogPanel />)
        const text = container.textContent ?? ''
        expect(text).toContain('login.whatYouCanDo')
        expect(text).toContain('feature1Title')
        expect(text).toContain('feature1Desc')
        expect(text).toContain('feature2Title')
        expect(text).toContain('feature2Desc')
        expect(text).toContain('feature3Title')
        expect(text).toContain('feature3Desc')
        expect(text).toContain('awaiting token')
    })
})
