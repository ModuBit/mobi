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
    rightPanePx,
    DEFAULT_LEFT_MIN_RATIO,
} from '@/ui/base/layout/splitLayoutUtils'

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

    describe('shouldCollapseOnDrag（指针越过视觉分隔条 + 容差即收起）', () => {
        // 容器 left=0 width=1000；容差 = 2% × 1000 = 20px
        it('无下限：右侧占比 < 2%（视觉分隔条贴右缘）判定收起', () => {
            // x=990 → 右占 1% < 2% → 收起；x=980 → 恰 2% 不收起
            expect(shouldCollapseOnDrag(990, 0, 1000, 0)).toBe(true)
            expect(shouldCollapseOnDrag(1000, 0, 1000, 0)).toBe(true)
            expect(shouldCollapseOnDrag(980, 0, 1000, 0)).toBe(false)
            expect(shouldCollapseOnDrag(500, 0, 1000, 0)).toBe(false)
        })

        it('下限抬住右栏：指针推过分隔条可达的最右位置（右缘-下限）即收起（视觉到底即折叠）', () => {
            // rightMinPx=200：分隔条最右只能到 x=800；死区里推进到 810 已越过即收起
            expect(shouldCollapseOnDrag(810, 0, 1000, 200)).toBe(true)
            expect(shouldCollapseOnDrag(850, 0, 1000, 200)).toBe(true)
            // 790 分隔条仍在跟随指针（右栏 210px 未触下限）→ 不收起
            expect(shouldCollapseOnDrag(790, 0, 1000, 200)).toBe(false)
        })

        it('考虑容器偏移（rectLeft>0）', () => {
            // 容器从 200 起、宽 1000；指针 1050 = 相对 850，同上收起
            expect(shouldCollapseOnDrag(1050, 200, 1000, 200)).toBe(true)
        })

        it('rectWidth<=0（首帧未测量）不收起', () => {
            expect(shouldCollapseOnDrag(990, 0, 0, 0)).toBe(false)
        })
    })

    describe('rightPanePx', () => {
        it('按 1-splitRatio 计算右栏宽度', () => {
            expect(rightPanePx(0.5, 1000, 0)).toBe(500)
            expect(rightPanePx(0.8, 1000, 0)).toBeCloseTo(200)
        })

        it('占比算出的宽度低于下限时抬到下限（窄容器里树列仍可用）', () => {
            // 回归：601px 容器 × 20% = 120px，筛选框被压到不可用
            expect(rightPanePx(0.8, 601, 200)).toBe(200)
        })

        it('占比宽度充足时不受下限影响', () => {
            expect(rightPanePx(0.5, 1000, 200)).toBe(500)
        })

        it('containerWidth<=0（首帧未测量）返回下限', () => {
            expect(rightPanePx(0.8, 0, 200)).toBe(200)
        })
    })
})
