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
import '@testing-library/jest-dom/vitest'
import { render, cleanup, act } from '@testing-library/react'
import FileContentViewHeader from '@/components/files/FileContentViewHeader'

// 记录 ResizeObserver callback，测试主动触发宽度变化
let roCb: ((entries: { target: HTMLElement; contentRect: { width: number } }[]) => void) | null = null
const observers: HTMLElement[] = []

beforeEach(() => {
    roCb = null
    observers.length = 0
    vi.stubGlobal('ResizeObserver', class {
        constructor(cb: any) { roCb = cb }
        observe(el: HTMLElement) { observers.push(el) }
        unobserve() {}
        disconnect() {}
    })
})
afterEach(() => { vi.unstubAllGlobals(); cleanup() })

/** 模拟容器宽度变化并触发 layout effect */
function setWidth(el: HTMLElement, width: number) {
    Object.defineProperty(el, 'clientWidth', { configurable: true, value: width })
    Object.defineProperty(el, 'scrollWidth', { configurable: true, value: width })
    roCb?.([{ target: el, contentRect: { width } }])
}

describe('FileContentViewHeader 面包屑左省略', () => {
    it('空间足够 → 完整显示所有段，无省略号', () => {
        const { container } = render(
            <FileContentViewHeader
                sessionId="s" tabId="t" filePath="a/b/c.ts"
                extraMenuItems={[]}
            />,
        )
        const crumb = observers[0]
        setWidth(crumb, 1000)
        expect(container.textContent).toContain('a')
        expect(container.textContent).toContain('b')
        expect(container.textContent).toContain('c.ts')
        expect(container.textContent).not.toContain('…')
    })

    it('extraMenuItems 渲染到 more 菜单触发器（按钮存在）', () => {
        const { container } = render(
            <FileContentViewHeader
                sessionId="s" tabId="t" filePath="a.ts"
                extraMenuItems={[{ key: 'x', label: 'X' }]}
            />,
        )
        expect(container.querySelector('button')).toBeInTheDocument()
    })

    it('空间不够 → 二分收敛到只保留文件名，左侧出现省略号', async () => {
        // scrollWidth 恒定远大于 clientWidth：模拟「无论砍多少段都溢出」→ 应收敛到 lastIndex
        const { container } = render(
            <FileContentViewHeader
                sessionId="s" tabId="t" filePath="a/b/c/d.ts"
                extraMenuItems={[]}
            />,
        )
        const crumb = observers[0]
        await act(async () => {
            Object.defineProperty(crumb, 'clientWidth', { configurable: true, value: 50 })
            Object.defineProperty(crumb, 'scrollWidth', { configurable: true, value: 1000 })
            roCb?.([{ target: crumb, contentRect: { width: 50 } }])
            // ResizeObserver 回调经 rAF 合并后才 setCrumbWidth，flush 一帧让收敛链跑完
            await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
        })
        // 收敛到 lastIndex（d.ts），前三段被砍、出现省略号
        expect(container.textContent).toContain('…')
        expect(container.textContent).toContain('d.ts')
        expect(container.textContent).not.toContain('a')
        expect(container.textContent).not.toContain('b')
        expect(container.textContent).not.toContain('c')
    })
})
