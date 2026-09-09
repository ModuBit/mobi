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
})
