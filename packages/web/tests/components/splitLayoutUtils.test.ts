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
import {
    computeSplitRatio,
    shouldCollapseOnDrag,
    DEFAULT_LEFT_MIN_RATIO,
} from '@/components/ui/splitLayoutUtils'

describe('splitLayoutUtils', () => {
    describe('computeSplitRatio', () => {
        it('容器中点返回 0.5', () => {
            expect(computeSplitRatio(500, 0, 1000)).toBe(0.5)
        })

        it('指针在左边缘 clamp 到默认最小占比（不跌破安全宽度）', () => {
            expect(computeSplitRatio(0, 0, 1000)).toBe(DEFAULT_LEFT_MIN_RATIO)
            expect(computeSplitRatio(-100, 0, 1000)).toBe(DEFAULT_LEFT_MIN_RATIO)
        })

        it('指针在右边缘返回 1（右侧可收到 0）', () => {
            expect(computeSplitRatio(1000, 0, 1000)).toBe(1)
            expect(computeSplitRatio(1200, 0, 1000)).toBe(1)
        })

        it('考虑容器偏移（rectLeft>0）', () => {
            // 容器从 x=200 开始，宽 1000；指针在 x=700（中点）→ 0.5
            expect(computeSplitRatio(700, 200, 1000)).toBe(0.5)
        })

        it('rectWidth<=0 返回最小占比，避免除零', () => {
            expect(computeSplitRatio(500, 0, 0)).toBe(DEFAULT_LEFT_MIN_RATIO)
        })

        it('支持自定义最小占比', () => {
            // minRatio=0.3：指针在 x=100（raw=0.1）应 clamp 到 0.3
            expect(computeSplitRatio(100, 0, 1000, 0.3)).toBe(0.3)
            // 中点不受 minRatio 影响
            expect(computeSplitRatio(500, 0, 1000, 0.3)).toBe(0.5)
        })
    })

    describe('shouldCollapseOnDrag', () => {
        it('右侧占比 < 2%（左侧>0.98）判定收起', () => {
            expect(shouldCollapseOnDrag(0.99)).toBe(true)
            expect(shouldCollapseOnDrag(1)).toBe(true)
        })

        it('正常比例不收起', () => {
            expect(shouldCollapseOnDrag(0.5)).toBe(false)
            expect(shouldCollapseOnDrag(0.8)).toBe(false)
            expect(shouldCollapseOnDrag(0.98)).toBe(false)
        })
    })
})
