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
 * shadcn 命名主题变量投影规格（shadcn 底座票 02）：
 * - buildShadcnThemeCss：双档各出全套 --background 系变量，light 挂 :root、dark 挂 .dark，
 *   值随档位翻转且与 tokens.ts 对齐；
 * - injectShadcnThemeCss：幂等注入 document.head，已存在则原地更新（切档不重建）。
 * 范式对照 tests/ui/MobiThemeInjection.test.ts（buildMobiThemeCss 先例）。
 */

import { describe, it, expect, afterEach } from 'vitest'
import { buildShadcnThemeCss, injectShadcnThemeCss, SHADCN_TOKENS_STYLE_ID } from '@/core/config/theme/cssVars'

afterEach(() => {
    document.getElementById(SHADCN_TOKENS_STYLE_ID)?.remove()
    document.documentElement.classList.remove('dark')
})

describe('buildShadcnThemeCss（--background 系主题变量）', () => {
    it('双档各出全套变量且值随档位翻转', () => {
        const light = buildShadcnThemeCss('light')
        const dark = buildShadcnThemeCss('dark')
        for (const css of [light, dark]) {
            expect(css).toContain('--background:')
            expect(css).toContain('--foreground:')
            expect(css).toContain('--primary:')
            expect(css).toContain('--primary-foreground:')
            expect(css).toContain('--secondary:')
            expect(css).toContain('--muted:')
            expect(css).toContain('--muted-foreground:')
            expect(css).toContain('--accent:')
            expect(css).toContain('--destructive:')
            expect(css).toContain('--border:')
            expect(css).toContain('--input:')
            expect(css).toContain('--ring:')
            expect(css).toContain('--radius:')
        }
        // 弹层 z 基线（spec D6，票 03 实测 antd z1000 会盖生态默认 z50）
        expect(light).toContain('--mobi-z-overlay: 1080')
        // registry 组件（弹层）实际消费而标准 shadcn 集未覆盖的 token——
        // 弹层 portal 到 body，antd 的 --ant-* 在子树外不可解析，这些必须全局可得
        for (const css of [light, dark]) {
            expect(css).toContain('--border-strong:')
            expect(css).toContain('--border-subtle:')
            expect(css).toContain('--text-secondary:')
            expect(css).toContain('--radius-lg:')
            expect(css).toContain('--shadow-resting:')
            expect(css).toContain('--shadow-floating:')
            // motion 投影（antd cssVar 不产出 motion 变量，组件不得自带第二套缓动语言）
            expect(css).toContain('--mobi-duration-fast:')
            expect(css).toContain('--mobi-duration-mid:')
            expect(css).toContain('--mobi-ease-out:')
            expect(css).toContain('--mobi-ease-in-out:')
        }
        expect(light).toContain('--radius-lg: 14px')
        expect(dark).toContain('--text-secondary: #d1cfc5')
        // 档位值确实翻转（light bg 米白 / dark bg 深灰）
        expect(light).toContain('--background: #faf9f5')
        expect(dark).toContain('--background: #141413')
        expect(light).toContain('--foreground: #141413')
        expect(dark).toContain('--foreground: #faf9f5')
        expect(light).toContain('--primary: #3d3d3a')
        expect(dark).toContain('--primary: #faf9f5')
    })

    it('light 挂 :root、dark 挂 .dark 选择器，radius 带 px 单位', () => {
        const light = buildShadcnThemeCss('light')
        const dark = buildShadcnThemeCss('dark')
        expect(light).toMatch(/^:root \{/)
        expect(dark).toMatch(/^\.dark \{/)
        expect(light).toContain('--radius: 10px')
    })
})

describe('injectShadcnThemeCss（幂等注入）', () => {
    it('注入后同 id 原地更新，切档不重建节点', () => {
        injectShadcnThemeCss(document, 'light')
        const first = document.getElementById(SHADCN_TOKENS_STYLE_ID)
        expect(first).not.toBeNull()
        expect(first?.textContent).toContain('#faf9f5')

        injectShadcnThemeCss(document, 'dark')
        const second = document.getElementById(SHADCN_TOKENS_STYLE_ID)
        expect(second).toBe(first) // 原地更新而非重建
        expect(second?.textContent).toContain('--background: #141413')
        expect(second?.textContent).not.toContain('--background: #faf9f5')
    })
})
