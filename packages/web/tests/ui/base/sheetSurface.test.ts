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
 * 壳的类名契约：`sheetClass` 里导出的每个类名都必须在样式表里有同名选择器。
 *
 * 为什么要这条守卫：CSS Modules 的类型在本工程是宽松映射，写错键名（`styles.hedaer`）
 * 既过 typecheck 也过 eslint，运行时只是**静默丢样式**——「面」没了边框圆角、
 * 头部少了内衬，而且只有真机肉眼能发现。这条守卫把这类笔误变成红灯。
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import { createElement } from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SheetClose, sheetClass, sheetIconButtonClass, sheetSurfaceClass, sheetHeaderClass } from '@/ui/base/layout/sheetSurface'

afterEach(cleanup)

const css = readFileSync(join(process.cwd(), 'src/ui/base/layout/sheetSurface.module.css'), 'utf8')

/** 选择器里存在 `.name`（后随非类名字符，避免 .body 命中 .bodyText） */
const hasClass = (name: string): boolean => new RegExp(`\\.${name}(?![\\w-])`).test(css)

/**
 * 从 CSS Modules 的 scoped 名取回局部名：vite 生成 `_<local>_<hash>`（实测 `_mask_eb5a37`）。
 * 格式变了这条守卫会整体变红——响而不是静默，符合它存在的意义。
 */
const localOf = (scoped: string): string => scoped.split('_').filter(Boolean).slice(0, -1).join('_')

describe('sheetSurface 壳', () => {
    it('sheetClass 的每个类名都在样式表里有选择器', () => {
        for (const [key, scoped] of Object.entries(sheetClass)) {
            const local = localOf(scoped)
            expect(local, `类名 ${scoped}（sheetClass.${key}）不像 CSS Modules 的 scoped 名`).not.toBe('')
            expect(hasClass(local), `样式表里缺 .${local}（sheetClass.${key}）`).toBe(true)
        }
    })

    /**
     * 变量块的选择器必须是元素上真实存在的类。抽壳时曾把它写成
     * `[data-sheet-surface]` / `[data-sheet-mask]`——没有任何地方渲染这两个属性，
     * 结果是底色 / 内衬 / 字号静默回落空值（真机看：面变透明）。类型与 lint 都拦不住。
     */
    it('变量块挂在 .mask / .surface 上，而不是没人渲染的 data 属性', () => {
        const block = /([^{}\n]+)\{[^}]*--surface-raised: var\(--popover\)/.exec(css)
        expect(block, '样式表里找不到挂 --surface-raised 的变量块').not.toBeNull()
        const selector = block![1]
        expect(selector).toContain('.mask')
        expect(selector).toContain('.surface')
        expect(selector).not.toContain('[data-')
    })

    it('两种面形状与两种头部布局都有规则', () => {
        expect(hasClass('surfaceBottom')).toBe(true)
        expect(hasClass('surfaceFloating')).toBe(true)
        expect(hasClass('headerToolbar')).toBe(true)
    })

    /**
     * 默认尺寸档必须落在 `.iconBtn` 基类里：曾经把 2rem 单独放 `.iconBtnCompact`，而
     * 类函数漏挂它 —— 桌面的关闭 / 取消 / 全屏钮全塌成 18px（内容宽），只有真机看得见。
     */
    it('图标钮基类自带默认盒尺寸（32px），touch 档再放大', () => {
        const base = /\.iconBtn \{[^}]*\}/.exec(css)![0]
        expect(base).toMatch(/width: 2rem;/)
        expect(base).toMatch(/height: 2rem;/)
        const touch = /\.iconBtnTouch \{[^}]*\}/.exec(css)![0]
        expect(touch).toMatch(/width: 2\.5rem;/)
        expect(sheetIconButtonClass({ size: 'touch' })).toContain(sheetClass.iconBtnTouch)
        expect(sheetIconButtonClass({ size: 'compact' })).not.toContain(sheetClass.iconBtnTouch)
        expect(sheetIconButtonClass({ bordered: false })).not.toContain(sheetClass.iconBtnBordered)
    })

    /**
     * 图标钮的圆角取「图标键」档（DESIGN「Shapes」明写：工具条里的纯图标按钮比控件档收一档，
     * 才不像药丸）。曾用 pill —— 同一条工具条上就成了药丸 + 圆角矩形两套形状语言。
     */
    it('图标钮圆角取图标键档，不是药丸', () => {
        const base = /\.iconBtn \{[^}]*\}/.exec(css)![0]
        expect(base).toMatch(/border-radius: var\(--radius-icon\);/)
        expect(base).not.toMatch(/border-radius: var\(--radius-pill\);/)
    })

    /** 按压缩放属动效，必须门在 reduced-motion 的 no-preference 里；reduced 档保留变色 */
    it('按压反馈：变色恒在，缩放只在允许动效时上', () => {
        expect(css).toMatch(/\.iconBtn:not\(:disabled\):active \{[^}]*color: var\(--foreground\);/)
        const gated = /@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\.iconBtn:not\(:disabled\):active \{[^}]*scale: 0\.96;/
        expect(css).toMatch(gated)
    })

    /** 画布这类不滚的内容区靠 data-bordered 标记常驻发丝线（data-scrolled 永不触发） */
    it('头部有常驻发丝线档', () => {
        expect(css).toMatch(/\.header\[data-bordered\]::after \{\s*opacity: 1;/)
    })

    /**
     * 抓取光标是对用户的承诺：头部不可拖的使用方（画板的 PC 停靠形态）挂着 grab 是骗人。
     * touch-action 同理——它把该区域的触摸手势整个拿走，没有拖拽语义的头部不该付这个代价。
     */
    it('抓取光标与 touch-action 归 data-draggable 一支', () => {
        const base = /\.header \{[^}]*\}/.exec(css)![0]
        expect(base).toMatch(/cursor: default;/)
        expect(base).not.toMatch(/cursor: grab/)
        expect(base).not.toMatch(/touch-action: none/)
        const draggable = /\.header\[data-draggable\] \{[^}]*\}/.exec(css)![0]
        expect(draggable).toMatch(/cursor: grab;/)
        expect(draggable).toMatch(/touch-action: none;/)
    })

    it('变体函数：都带基础类，且形状两档互不相同', () => {
        expect(sheetSurfaceClass()).toBe(sheetSurfaceClass('bottom'))
        expect(sheetSurfaceClass('bottom')).toContain(sheetClass.surface)
        expect(sheetSurfaceClass('floating')).toContain(sheetClass.surface)
        expect(sheetSurfaceClass('bottom')).not.toBe(sheetSurfaceClass('floating'))
        expect(sheetHeaderClass('title')).toBe(sheetClass.header)
        expect(sheetHeaderClass('toolbar')).toContain(sheetClass.header)
    })
})

describe('SheetClose', () => {
    it('带壳的关闭类与无障碍名', () => {
        const { getByRole } = render(createElement(SheetClose, { label: '关闭 工具详情' }))
        const btn = getByRole('button')
        expect(btn.className).toContain(sheetClass.iconBtn)
        expect(btn.className).toContain(sheetClass.iconBtnBordered)
        expect(btn.getAttribute('aria-label')).toBe('关闭 工具详情')
    })

    /** Radix 的 Close 用 asChild 包住它——props 必须落到真实 button 上，否则点击关不掉 */
    it('透传外部 props（onClick / className）', () => {
        const onClick = vi.fn()
        const { getByRole } = render(
            createElement(SheetClose, { label: '关闭', onClick, className: 'caller-extra', type: 'button' }),
        )
        const btn = getByRole('button')
        expect(btn.className).toContain('caller-extra')
        fireEvent.click(btn)
        expect(onClick).toHaveBeenCalledTimes(1)
    })
})
