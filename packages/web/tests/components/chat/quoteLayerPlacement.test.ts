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

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup } from '@testing-library/react'
import { computeQuoteLayerPlacement, QUOTE_LAYER_GAP, QUOTE_LAYER_VIEWPORT_MARGIN } from '@/components/chat/quoteLayerPlacement'

/** 800×600 视口（jsdom 默认 innerWidth/innerHeight），测试内按需改写后还原 */
function withViewport(width: number, height: number, fn: () => void): void {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: height })
    fn()
    Reflect.deleteProperty(window, 'innerWidth')
    Reflect.deleteProperty(window, 'innerHeight')
}

afterEach(cleanup)

describe('computeQuoteLayerPlacement（浮层定位）', () => {
    it('选区足够靠下 → 上方放置，top = rect.top - GAP，left 中心对齐', () => {
        withViewport(800, 600, () => {
            const p = computeQuoteLayerPlacement(new DOMRect(100, 300, 200, 20), 260, 140, 120)
            expect(p.above).toBe(true)
            expect(p.top).toBe(300 - QUOTE_LAYER_GAP)
            expect(p.left).toBe(100 + 100 - 130)
        })
    })

    it('选区顶边高于翻转阈值 → 下方放置，top = rect.bottom + GAP', () => {
        withViewport(800, 600, () => {
            const p = computeQuoteLayerPlacement(new DOMRect(100, 100, 200, 20), 260, 140, 120)
            expect(p.above).toBe(false)
            expect(p.top).toBe(120 + QUOTE_LAYER_GAP)
        })
    })

    it('下方放置但浮层会溢出视口下缘 → top 钳回下缘内（确认/取消按钮保持可点）', () => {
        withViewport(800, 600, () => {
            // 顶部起选的大选区：top=100 ≤ 阈值 → 下方放置；rect.bottom=580，+GAP=588，
            // 588 + 高 120 = 708 > 600 → 钳到 600-120-8 = 472
            const p = computeQuoteLayerPlacement(new DOMRect(100, 100, 200, 480), 260, 140, 120)
            expect(p.above).toBe(false)
            expect(p.top).toBe(600 - 120 - QUOTE_LAYER_VIEWPORT_MARGIN)
        })
    })

    it('水平越出视口边缘 → 钳回边距内', () => {
        withViewport(800, 600, () => {
            // 选区左缘 0 宽 20，中心 10 → left = 10-130 = -120 → 钳到 8
            const p = computeQuoteLayerPlacement(new DOMRect(0, 300, 20, 20), 260, 140, 120)
            expect(p.left).toBe(QUOTE_LAYER_VIEWPORT_MARGIN)
        })
    })
})
