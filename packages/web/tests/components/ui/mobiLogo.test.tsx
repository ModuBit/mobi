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

import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { MOBI_MARK_PATH } from '@/components/layout/brandPaths'
import { useUiStore } from '@/core/data/stores/uiStore'

const { MobiLogo } = await import('@/components/ui/MobiLogo')

afterEach(cleanup)

describe('MobiLogo 品牌动画组件', () => {
    it('渲染 SVG 结构：两耳（共享 mark path 镜像）+ 鼻头，默认 64 尺寸 + loop', () => {
        const { container } = render(<MobiLogo />)
        const svg = container.querySelector('svg')
        expect(svg).not.toBeNull()
        expect(svg).toHaveAttribute('viewBox', '0 0 250 250')
        expect(svg).toHaveAttribute('width', '64')
        expect(svg).toHaveAttribute('height', '64')
        // 装饰性动画：可访问名由调用方文案承载
        expect(svg).toHaveAttribute('aria-hidden', 'true')

        // 两耳共享同一 mark path（右耳为镜像），鼻头圆点
        const paths = container.querySelectorAll('path')
        expect(paths).toHaveLength(2)
        paths.forEach(p => expect(p).toHaveAttribute('d', MOBI_MARK_PATH))
        const nose = container.querySelector('circle')
        expect(nose).toHaveAttribute('cx', '125')
        expect(nose).toHaveAttribute('cy', '161')
        expect(nose).toHaveAttribute('r', '16.5')

        // 默认 loop：无限循环（播放控制在 Face g 的 inline style 上）
        expect(container.querySelector('g')).toHaveStyle({ animationIterationCount: 'infinite' })
    })

    it('size prop 控制边长', () => {
        const { container } = render(<MobiLogo size={80} />)
        const svg = container.querySelector('svg')
        expect(svg).toHaveAttribute('width', '80')
        expect(svg).toHaveAttribute('height', '80')
    })

    it("play='once' 播一轮后定格（iteration-count 1 + forwards）", () => {
        const { container } = render(<MobiLogo play="once" />)
        expect(container.querySelector('g')).toHaveStyle({
            animationIterationCount: '1',
            animationFillMode: 'forwards',
        })
    })

    it('颜色随主题切换（light 深色标记 / dark 浅色标记）', () => {
        const { container, rerender } = render(<MobiLogo />)

        useUiStore.setState({ theme: 'light' })
        rerender(<MobiLogo />)
        expect(container.querySelector('svg')).toHaveStyle({ color: '#141413' })

        useUiStore.setState({ theme: 'dark' })
        rerender(<MobiLogo />)
        expect(container.querySelector('svg')).toHaveStyle({ color: '#faf9f5' })

        useUiStore.setState({ theme: 'light' })
    })
})
