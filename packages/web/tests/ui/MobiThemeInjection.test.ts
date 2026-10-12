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
 * mode=app 主题注入规格（generative-ui 票 05）：
 * - buildMobiThemeCss：双档各出全套 --mobi-* 变量；base（color-scheme/body）走
 *   :where() 低特异性——app 自带样式永远赢；变量是宿主→app 输入通道（:root）；
 * - injectMobiThemeStyle：幂等注入，已存在则原地更新（宿主切档不重载 iframe）；
 * - classifyArtifact：mode='app' 仅对 HTML 给 app 标记并蕴含 wide；card 覆盖优先、
 *   非 HTML 文件上的 app 忽略（对媒体注入主题无意义）。
 */

import { describe, it, expect } from 'vitest'
import { buildMobiThemeCss, injectMobiThemeStyle } from '@/ui/sandboxAppHost'
import { MOBI_THEME_VAR_LIST } from '@mobi/shared'
import { classifyArtifact, parseArtifactParams } from '@/domain/chat/artifactDirectives'

describe('buildMobiThemeCss（--mobi-* 主题变量）', () => {
    it('双档各出全套变量且值随档位翻转', () => {
        const light = buildMobiThemeCss('light')
        const dark = buildMobiThemeCss('dark')
        for (const css of [light, dark]) {
            expect(css).toContain('--mobi-bg:')
            expect(css).toContain('--mobi-fg:')
            expect(css).toContain('--mobi-primary:')
            expect(css).toContain('--mobi-border:')
            expect(css).toContain('--mobi-radius:')
            expect(css).toContain('--mobi-font-body:')
            expect(css).toContain('--mobi-font-mono:')
        }
        expect(light).toContain('color-scheme: light')
        expect(dark).toContain('color-scheme: dark')
        // 档位值确实不同（light bg 是米白、dark 是深灰）
        expect(light).not.toContain(dark.match(/--mobi-bg: [^;]+/)?.[0] ?? '')
    })

    it('base 样式低特异（:where），变量通道在 :root——app 自带样式可覆盖', () => {
        const css = buildMobiThemeCss('light')
        expect(css).toContain(':where(:root)')
        expect(css).toContain(':where(body)')
        // 变量声明不带 :where（:root 通道），保证 app 消费到确定值
        expect(css).toMatch(/^:root \{/m)
    })

    it('注入变量 ⊇ shared 词表全集（表加变量漏配来源即红——教学与注入同 pivot）', () => {
        for (const mode of ['light', 'dark'] as const) {
            const css = buildMobiThemeCss(mode)
            for (const v of MOBI_THEME_VAR_LIST) {
                expect(css).toContain(`${v}: `)
            }
        }
    })
})

describe('injectMobiThemeStyle（幂等注入 + 原地更新）', () => {
    it('注入后重复调用不同档位 → 原地更新 textContent（不重载 iframe）', () => {
        const el = document.createElement('div')
        document.body.appendChild(el)
        const style = () => el.querySelector('style#mobi-app-theme')

        injectMobiThemeStyle(el.ownerDocument === document ? null : null, 'light') // 空文档跳过
        expect(style()).toBeNull()

        // 用真实空文档测注入/更新路径
        const doc = document.implementation.createHTMLDocument('test')
        injectMobiThemeStyle(doc, 'light')
        const injected = doc.getElementById('mobi-app-theme')
        expect(injected).not.toBeNull()
        expect(injected!.textContent).toContain('color-scheme: light')

        injectMobiThemeStyle(doc, 'dark')
        const after = doc.getElementById('mobi-app-theme')
        expect(after).toBe(injected) // 同一元素原地更新
        expect(after!.textContent).toContain('color-scheme: dark')

        el.remove()
    })
})

describe('classifyArtifact mode=app（generative-ui 票 05）', () => {
    const ready = { status: 'ready' as const, size: 100, etag: 'e1' }

    it('HTML + mode=app → inline 且 app 标记 + 蕴含 wide 高档', () => {
        const v = classifyArtifact('/tmp/a.html', ready, 'app')
        expect(v).toEqual({ action: 'inline', kind: 'html', etag: 'e1', wide: true, app: true })
    })

    it('mode=app 解析进 ArtifactParams（parse 收口）', () => {
        expect(parseArtifactParams({ path: '/tmp/a.html', mode: 'app' })).toEqual({ path: '/tmp/a.html', mode: 'app' })
    })

    it('非 HTML 文件上的 app 忽略（图片 app 无意义，按 auto 处理）', () => {
        const v = classifyArtifact('/tmp/a.png', ready, 'app')
        expect(v).toMatchObject({ action: 'inline', kind: 'image', app: false, wide: false })
    })

    it('card 覆盖优先于 app；非法 mode 值仍按 auto', () => {
        expect(classifyArtifact('/tmp/a.html', ready, 'card').action).toBe('card')
        const v = classifyArtifact('/tmp/a.html', ready, 'appp')
        expect(v).toMatchObject({ action: 'inline', app: false, wide: false })
    })

    it('既有 mode 缺省/wide 行为零变化（回归）', () => {
        expect(classifyArtifact('/tmp/a.html', ready)).toMatchObject({ action: 'inline', wide: false, app: false })
        expect(classifyArtifact('/tmp/a.html', ready, 'wide')).toMatchObject({ action: 'inline', wide: true, app: false })
    })
})
