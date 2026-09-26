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
 * x-markdown fade-in 起点覆盖的顺序契约（防「部分内容闪烁」回归）。
 *
 * 背景：占位组件（incomplete-emphasis/link/inline-code）与闭合后正式渲染的宿主
 * 元素在 React 树形态上不同，闭合瞬间必然 remount；section 封口时已完成块也会
 * 因 Renderer key 平移 remount。重挂的 AnimationText 从头重播 fade-in——包默认
 * from opacity:0 即肉眼闪烁，markdownOverride.css 把起点抬到 0.35 缓解。
 *
 * 覆盖生效的条件是「同名 keyframes 后定义者胜」：该 css 必须在
 * '@ant-design/x-markdown'（携带包内 index.css）之后导入，且两者同 chunk
 * （放 base.css 会被 lazy 路由 chunk 的包 css 顶掉——2026-09-26 实测）。
 * jsdom 不加载 css，DOM 断言不可行；此处锁源码级导入顺序契约，是可用缝里
 * 最贴近失效模式的守护。
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const source = readFileSync(join(__dirname, '../../src/components/ui/Markdown.tsx'), 'utf-8')

describe('Markdown fade-in 覆盖的导入顺序契约', () => {
    it('markdownOverride.css 在 @ant-design/x-markdown 之后导入', () => {
        const xmdImport = source.indexOf("from '@ant-design/x-markdown'")
        const overrideImport = source.indexOf("import './markdownOverride.css'")
        expect(xmdImport).toBeGreaterThan(-1)
        expect(overrideImport).toBeGreaterThan(xmdImport)
    })

    it('覆盖定义存在且起点为 0.35', () => {
        const css = readFileSync(join(__dirname, '../../src/components/ui/markdownOverride.css'), 'utf-8')
        expect(css).toContain('@keyframes x-markdown-fade-in')
        expect(css).toMatch(/from\s*{[^}]*opacity:\s*0\.35/s)
    })
})
