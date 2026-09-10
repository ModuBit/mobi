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

import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { PixelLoader } from '@/components/ui/PixelLoader'

describe('PixelLoader', () => {
    it('渲染 9 个像素格，按 chevron 波形逐格注入 delay', () => {
        const { container } = render(<PixelLoader />)
        const cells = container.querySelectorAll('.pixel-loader-cell')
        expect(cells).toHaveLength(9)
        cells.forEach(cell => {
            expect((cell as HTMLElement).style.animationDelay).toBeTruthy()
        })
    })

    it('容器 aria-hidden；格子样式由 CSS 类承载（inline 无静态视觉属性）', () => {
        const { container } = render(<PixelLoader />)
        const grid = container.firstChild as HTMLElement
        expect(grid.getAttribute('aria-hidden')).toBe('true')
        const cell = container.querySelector('.pixel-loader-cell') as HTMLElement
        expect(cell.style.background).toBe('')
    })

    it('orbit 变体：中心格静止暗态（无动画），外圈 8 格按环绕序错峰', () => {
        const { container } = render(<PixelLoader variant="orbit" />)
        const grid = container.firstChild as HTMLElement
        expect(grid.className).toContain('pixel-loader-orbit')

        const cells = container.querySelectorAll('.pixel-loader-cell')
        expect(cells).toHaveLength(9)
        // 中心格：静止暗态（样式由 idle 类承载）
        const idle = container.querySelector('.pixel-loader-cell-idle') as HTMLElement
        expect(idle).not.toBeNull()
        expect(idle.style.animationDelay).toBe('')
        // 外圈：带 delay、950ms 周期
        const orbiting = Array.from(cells).filter(c => !(c as HTMLElement).classList.contains('pixel-loader-cell-idle'))
        expect(orbiting).toHaveLength(8)
        orbiting.forEach(cell => {
            expect((cell as HTMLElement).style.animationDelay).toBeTruthy()
            expect((cell as HTMLElement).style.animationDuration).toBe('950ms')
        })
    })

    it('twinkle 变体：6 格错峰眨眼（随机感与动画数的折中），错相经容器 --phase 注入', () => {
        const { container } = render(<PixelLoader variant="twinkle" phase={2.5} />)
        const grid = container.firstChild as HTMLElement
        expect(grid.className).toContain('pixel-loader-twinkle')
        expect(grid.style.getPropertyValue('--phase')).toBe('2.5s')

        const cells = container.querySelectorAll('.pixel-loader-cell')
        expect(cells).toHaveLength(9)
        const twinkling = Array.from(cells).filter(c => (c as HTMLElement).style.animationName === 'pixel-twinkle')
        expect(twinkling).toHaveLength(6)
        twinkling.forEach(cell => {
            const style = (cell as HTMLElement).style
            expect(style.animationDuration).toBe('5s')
            expect(style.animationDelay).toContain('var(--phase')
        })
        // 其余 3 格静止基线（idle 类承载）
        const idle = Array.from(cells).filter(c => (c as HTMLElement).classList.contains('pixel-loader-cell-idle'))
        expect(idle).toHaveLength(3)
    })

    it('ghost 变体：全格静止（0.12 可辨认暗态，独立于 idle 0.07）', () => {
        const { container } = render(<PixelLoader variant="ghost" />)
        const cells = container.querySelectorAll('.pixel-loader-cell')
        expect(cells).toHaveLength(9)
        cells.forEach(cell => {
            expect((cell as HTMLElement).classList.contains('pixel-loader-cell-ghost')).toBe(true)
        })
    })

    it('size 数值经 --pixel-cell 注入（CSS 变量驱动格边长），color 走容器继承', () => {
        const { container } = render(<PixelLoader variant="drive" size={3} color="#ffa726" />)
        const grid = container.firstChild as HTMLElement
        expect(grid.style.getPropertyValue('--pixel-cell')).toBe('3px')
        expect(grid.style.color).toBe('rgb(255, 167, 38)')
        // 缺省 4px
        const dflt = render(<PixelLoader />)
        expect(dflt.container.firstChild as HTMLElement).toBeTruthy()
        expect((dflt.container.firstChild as HTMLElement).style.getPropertyValue('--pixel-cell')).toBe('4px')
    })
})
