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
 * Favicon 契约：globe 占位 → 探测成功换 img / 失败保持 globe；模块级缓存同 host
 * 只探测一次；畸形 href 降级 globe。Image 探测在 jsdom 无网络层，mock 全局 Image
 * 手动触发回调。模块级 FAVICON_STATE 跨用例存活——各用例用不同 host 隔离。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

const imageInstances: Array<{
    onload: (() => void) | null
    onerror: (() => void) | null
    src: string
}> = []

beforeEach(() => {
    imageInstances.length = 0
    vi.stubGlobal('Image', class MockImage {
        onload: (() => void) | null = null
        onerror: (() => void) | null = null
        referrerPolicy = ''
        src = ''
        constructor() {
            imageInstances.push(this)
        }
    })
})

afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
})

import { Favicon } from '@/components/ui/Favicon'

describe('Favicon', () => {
    it('探测期间渲染 globe 占位（无布局跳动），首选直连 favicon.ico', () => {
        const { container } = render(<Favicon href="https://pending.example.com/a" />)
        expect(container.querySelector('svg')).toBeInTheDocument()
        expect(container.querySelector('img')).not.toBeInTheDocument()
        expect(imageInstances[0].src).toBe('https://pending.example.com/favicon.ico')
    })

    it('直连命中：img 出现且带 no-referrer', () => {
        const { container } = render(<Favicon href="https://ok.example.com/a" />)
        act(() => imageInstances[0].onload?.())
        const img = container.querySelector('img')
        expect(img).toHaveAttribute('src', 'https://ok.example.com/favicon.ico')
        expect(img).toHaveAttribute('referrerpolicy', 'no-referrer')
    })

    it('直连 404 降级 DuckDuckGo 聚合服务，命中即用', () => {
        const { container } = render(<Favicon href="https://fallback.example.com/a" />)
        act(() => imageInstances[0].onerror?.())
        expect(imageInstances).toHaveLength(2)
        expect(imageInstances[1].src).toBe('https://icons.duckduckgo.com/ip3/fallback.example.com.ico')
        act(() => imageInstances[1].onload?.())
        expect(container.querySelector('img')).toHaveAttribute(
            'src',
            'https://icons.duckduckgo.com/ip3/fallback.example.com.ico',
        )
    })

    it('直连与 DDG 都失败再降级 Google s2，命中即用', () => {
        const { container } = render(<Favicon href="https://s2.example.com/a" />)
        act(() => imageInstances[0].onerror?.())
        act(() => imageInstances[1].onerror?.())
        expect(imageInstances).toHaveLength(3)
        expect(imageInstances[2].src).toBe('https://www.google.com/s2/favicons?domain=s2.example.com&sz=32')
        act(() => imageInstances[2].onload?.())
        expect(container.querySelector('img')).toHaveAttribute(
            'src',
            'https://www.google.com/s2/favicons?domain=s2.example.com&sz=32',
        )
    })

    it('三级都失败：保持 globe 占位，不渲染 img', () => {
        const { container } = render(<Favicon href="https://dead.example.com/a" />)
        act(() => imageInstances[0].onerror?.())
        act(() => imageInstances[1].onerror?.())
        act(() => imageInstances[2].onerror?.())
        expect(container.querySelector('img')).not.toBeInTheDocument()
        expect(container.querySelector('svg')).toBeInTheDocument()
    })

    it('同 host 二次挂载走缓存，不再发起探测', () => {
        render(<Favicon href="https://cached.example.com/a" />)
        act(() => imageInstances[0].onload?.())
        // 第二个实例（同 host 不同路径）直接 img，无第二次 Image 探测
        render(<Favicon href="https://cached.example.com/b" />)
        expect(imageInstances).toHaveLength(1)
        expect(document.querySelectorAll('img')).toHaveLength(2)
    })

    it('畸形 href：恒走 globe 占位，不探测', () => {
        const { container } = render(<Favicon href="::::" />)
        expect(container.querySelector('svg')).toBeInTheDocument()
        expect(imageInstances).toHaveLength(0)
    })
})
