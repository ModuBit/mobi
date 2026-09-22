/*
 * Copyright Maner·Fan
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * ShinyText 扫光统一入口测试：
 * 类挂载收口（shimmer-text / -solid 变体）、active 开关、className/style/rest 透传。
 * jsdom 无 IntersectionObserver：可见性观测整体跳过，恒可见路径（组件内已兜底）。
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { ShinyText } from '@/components/ui/ShinyText'

afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
})

describe('ShinyText', () => {
    it('默认渲染扫光层（shimmer-text 类）', () => {
        render(<ShinyText>正在思考</ShinyText>)
        const el = screen.getByText('正在思考')
        expect(el).toHaveClass('shimmer-text')
        expect(el).not.toHaveClass('shimmer-text-solid')
    })

    it('solid 变体挂双类', () => {
        render(<ShinyText solid>awaiting approval…</ShinyText>)
        const el = screen.getByText('awaiting approval…')
        expect(el).toHaveClass('shimmer-text', 'shimmer-text-solid')
    })

    it('active=false 渲染普通 span（不挂任何扫光类）', () => {
        render(<ShinyText active={false} className="crossfade-text">已落定</ShinyText>)
        const el = screen.getByText('已落定')
        expect(el).not.toHaveClass('shimmer-text')
        expect(el).toHaveClass('crossfade-text')
    })

    it('className 追加到扫光层（CrossfadeText 同元素承载 crossfade 场景）', () => {
        render(<ShinyText className="crossfade-text">扫光 + 淡入</ShinyText>)
        const el = screen.getByText('扫光 + 淡入')
        expect(el).toHaveClass('shimmer-text', 'crossfade-text')
    })

    it('style 与 rest 属性透传（aria-hidden 等读屏语义由调用方声明）', () => {
        render(
            <ShinyText aria-hidden="true" style={{ color: 'rgb(217, 119, 87)', maxWidth: 240 }}>
                vibing…
            </ShinyText>,
        )
        const el = screen.getByText('vibing…')
        expect(el).toHaveAttribute('aria-hidden', 'true')
        expect(el.style.color).toBe('rgb(217, 119, 87)')
        expect(el.style.maxWidth).toBe('240px')
    })

    it('active 切换：挂类随激活收口，无激活时不渲染 data-shimmer-off 观测标记', () => {
        const { rerender } = render(<ShinyText active={false}>任务名</ShinyText>)
        expect(screen.getByText('任务名')).not.toHaveClass('shimmer-text')

        rerender(<ShinyText>任务名</ShinyText>)
        const el = screen.getByText('任务名')
        expect(el).toHaveClass('shimmer-text')
        // jsdom 无 IO：观测跳过、恒可见，不出现屏外暂停标记
        expect(el).not.toHaveAttribute('data-shimmer-off')
    })

    it('IO 可见性语义：视口内 → 不暂停；视口外 → data-shimmer-off 暂停', () => {
        // stub IO：捕获实例，测试手动触发回调
        const observers: Array<{ callback: IntersectionObserverCallback; el: Element }> = []
        class IOStub {
            callback: IntersectionObserverCallback
            constructor(cb: IntersectionObserverCallback) {
                this.callback = cb
                observers.push({ callback: cb, el: null as unknown as Element })
            }
            observe(el: Element) { observers[observers.length - 1].el = el }
            unobserve() {}
            disconnect() {}
        }
        vi.stubGlobal('IntersectionObserver', IOStub)

        render(<ShinyText>运行中</ShinyText>)
        const el = screen.getByText('运行中')
        const io = observers[observers.length - 1]

        // 视口内（isIntersecting=true）→ 恒可见，动画不被暂停
        act(() => io.callback(
            [{ isIntersecting: true, target: el } as unknown as IntersectionObserverEntry],
            io as unknown as IntersectionObserver,
        ))
        expect(el).not.toHaveAttribute('data-shimmer-off')

        // 视口外（isIntersecting=false）→ 标记暂停
        act(() => io.callback(
            [{ isIntersecting: false, target: el } as unknown as IntersectionObserverEntry],
            io as unknown as IntersectionObserver,
        ))
        expect(el).toHaveAttribute('data-shimmer-off')
    })
})
