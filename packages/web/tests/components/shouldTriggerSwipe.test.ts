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
import { EDGE_WIDTH, HYSTERESIS, resolveEdgeSwipeDirection } from '@/components/ui/shouldTriggerSwipe'

describe('resolveEdgeSwipeDirection（左缘滑动方向锁判定）', () => {
    it('原地（零位移）→ pending', () => {
        expect(resolveEdgeSwipeDirection(10, 20, 10, 20)).toBe('pending')
    })

    it('两轴位移均未过迟滞 → pending（防误触）', () => {
        // dx=5、dy=8，均 <= HYSTERESIS(10)
        expect(resolveEdgeSwipeDirection(0, 0, 5, 8)).toBe('pending')
    })

    it('两轴恰好等于迟滞（均未"越过"）→ pending', () => {
        // dx=10、dy=10，均未超过阈值
        expect(resolveEdgeSwipeDirection(0, 0, 10, 10)).toBe('pending')
    })

    it('仅 dx 过阈、dy 在迟滞内 → horizontal（右滑意图）', () => {
        // dx=15 > 10，dy=3 <= 10
        expect(resolveEdgeSwipeDirection(5, 100, 20, 103)).toBe('horizontal')
    })

    it('dx 胜出（两轴均过阈但水平更大）→ horizontal', () => {
        // dx=30 > dy=12，两轴均过迟滞
        expect(resolveEdgeSwipeDirection(0, 0, 30, 12)).toBe('horizontal')
    })

    it('向左滑（负方向）dx 同样胜出 → horizontal（方向锁只看幅度胜出，不辨正负）', () => {
        // 起手已在最左缘（x=0），负方向位移在真实场景中不可达；
        // 纯函数按幅度对称处理，正负由起手层（热区内起手）天然约束
        expect(resolveEdgeSwipeDirection(15, 0, 0, 3)).toBe('horizontal')
    })

    it('dy 胜出 → vertical（用户在滚动，放弃跟踪）', () => {
        // dy=40 > dx=6
        expect(resolveEdgeSwipeDirection(5, 0, 11, 40)).toBe('vertical')
    })

    it('对角近似（dy 恰小于 dx）→ horizontal（dx > dy 严格比较）', () => {
        // dx=25、dy=24，dx > dy 判 horizontal
        expect(resolveEdgeSwipeDirection(0, 0, 25, 24)).toBe('horizontal')
        // 反过来 dy > dx 判 vertical
        expect(resolveEdgeSwipeDirection(0, 0, 24, 25)).toBe('vertical')
    })

    it('常量契约：热区 20px、迟滞 10px', () => {
        expect(EDGE_WIDTH).toBe(20)
        expect(HYSTERESIS).toBe(10)
    })
})
