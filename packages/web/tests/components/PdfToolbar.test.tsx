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

import { describe, it, expect, vi, afterEach } from 'vitest'
import React from 'react'
import '@testing-library/jest-dom/vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'

// mock react-i18next：绕过 i18n 文件依赖，让 PdfToolbar 独立可测
// 按钮文案渲染为 key 字符串（files.fitWidth / files.actualSize）
vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (k: string) => k }),
}))

// antd Button 把文本包在 <span> 里，getByText 返回的是内层 <span> 而非 <button>。
// toBeDisabled 只对 button/input 等表单元素生效，因此用 getByRole('button') 定位 <button>。
const zoomInBtn = () => screen.getByRole('button', { name: '+' })
const zoomOutBtn = () => screen.getByRole('button', { name: '-' })

import PdfToolbar, {
    MIN_SCALE,
    MAX_SCALE,
    SCALE_STEP,
} from '@/components/files/PdfToolbar'

describe('PdfToolbar', () => {
    afterEach(() => {
        cleanup()
    })

    it('显示当前 scale 百分比；点 + → onScaleChange(1.2)；点 - → onScaleChange(0.8)', () => {
        const onScaleChange = vi.fn()
        // scale=1.0 → 显示 100%；+0.2=1.2；-0.2=0.8
        render(
            <PdfToolbar
                scale={1.0}
                onScaleChange={onScaleChange}
                onFitWidth={vi.fn()}
                onReset={vi.fn()}
            />,
        )

        // 百分比显示
        expect(screen.getByText('100%')).toBeInTheDocument()

        // 点 +（text 被包在 button > span，用 role 定位 button 本身）
        fireEvent.click(zoomInBtn())
        expect(onScaleChange).toHaveBeenCalledWith(1.2)

        // 点 -
        fireEvent.click(zoomOutBtn())
        expect(onScaleChange).toHaveBeenCalledWith(0.8)
    })

    it('scale=MAX_SCALE 时 + 禁用；scale=MIN_SCALE 时 - 禁用', () => {
        // 上界：+ disabled
        const { rerender } = render(
            <PdfToolbar
                scale={MAX_SCALE}
                onScaleChange={vi.fn()}
                onFitWidth={vi.fn()}
                onReset={vi.fn()}
            />,
        )
        expect(zoomInBtn()).toBeDisabled()
        expect(zoomOutBtn()).not.toBeDisabled()

        // 下界：- disabled
        rerender(
            <PdfToolbar
                scale={MIN_SCALE}
                onScaleChange={vi.fn()}
                onFitWidth={vi.fn()}
                onReset={vi.fn()}
            />,
        )
        expect(zoomOutBtn()).toBeDisabled()
        expect(zoomInBtn()).not.toBeDisabled()
    })

    it('点「适应宽度」→ onFitWidth 调用；点「100%」→ onReset 调用', () => {
        const onFitWidth = vi.fn()
        const onReset = vi.fn()
        render(
            <PdfToolbar
                scale={1.5}
                onScaleChange={vi.fn()}
                onFitWidth={onFitWidth}
                onReset={onReset}
            />,
        )

        // 适应宽度按钮（i18n key 渲染）
        fireEvent.click(screen.getByText('files.fitWidth'))
        expect(onFitWidth).toHaveBeenCalledTimes(1)

        // 100% 按钮（i18n key 渲染）
        fireEvent.click(screen.getByText('files.actualSize'))
        expect(onReset).toHaveBeenCalledTimes(1)
    })

    it('常量导出：MIN_SCALE / MAX_SCALE / SCALE_STEP 值正确', () => {
        // 防止后续误改常量导致 clamp/步进逻辑错乱
        expect(MIN_SCALE).toBe(0.5)
        expect(MAX_SCALE).toBe(3)
        expect(SCALE_STEP).toBe(0.2)
    })
})
