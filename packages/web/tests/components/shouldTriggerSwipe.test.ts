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
import { EDGE_WIDTH, HYSTERESIS, shouldTriggerSwipe } from '@/components/ui/shouldTriggerSwipe'

describe('shouldTriggerSwipe（左缘右滑触发判定）', () => {
    it('起点在热区内 + 位移越过迟滞 → true', () => {
        // 起点 5 < EDGE_WIDTH(20)，位移 15 > HYSTERESIS(10)
        expect(shouldTriggerSwipe(5, 20)).toBe(true)
    })

    it('起点在热区内但位移未过迟滞 → false（防误触）', () => {
        // 位移仅 5px，未越过 10px 迟滞
        expect(shouldTriggerSwipe(5, 10)).toBe(false)
    })

    it('起点在热区外（>EDGE_WIDTH）→ 无论多大位移都 false', () => {
        // 起点 30 已出热区，位移 100 也不认手势
        expect(shouldTriggerSwipe(30, 130)).toBe(false)
    })

    it('起点在热区内但向左滑（负方向位移）→ false', () => {
        // 起点 0，currentX - startX = -20，方向不符
        expect(shouldTriggerSwipe(0, -20)).toBe(false)
    })

    it('常量契约：热区 20px、迟滞 10px', () => {
        expect(EDGE_WIDTH).toBe(20)
        expect(HYSTERESIS).toBe(10)
    })
})
