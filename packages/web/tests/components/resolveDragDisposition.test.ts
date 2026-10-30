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
import { resolveDragDisposition } from '@/ui/base/interactive/resolveDragDisposition'

describe('resolveDragDisposition（速度符号优先于位置——Apple 原则）', () => {
    const base = { height: 400 }
    it('快速下甩即关（真实行程达门槛），哪怕位移还很小', () => {
        expect(resolveDragDisposition({ ...base, offset: 60, velocity: 600, travel: 60 })).toBe('close')
    })
    it('微行程的高速释放不是甩：抖动点按收尾不得借速度关闭', () => {
        // 10~20px 的落点滚动在 80ms 采样窗里能算出 >500px/s 的瞬时速度；行程不足甩动
        // 门槛时速度不参与判定（真机表现：点会话行，面板被甩走、click 被吞）
        expect(resolveDragDisposition({ ...base, offset: 15, velocity: 600, travel: 15 })).toBe('settle')
    })
    it('快速上推回位，哪怕位移已过半', () => {
        expect(resolveDragDisposition({ ...base, offset: 250, velocity: -600, travel: 60 })).toBe('settle')
    })
    it('慢放：位移超过 sheet 高度 1/3 关闭（位置判据不受行程门槛影响）', () => {
        expect(resolveDragDisposition({ ...base, offset: 140, velocity: 0, travel: 140 })).toBe('close')
        expect(resolveDragDisposition({ ...base, offset: 130, velocity: 0, travel: 130 })).toBe('settle')
    })
    it('边界：速度阈值 ±500 内按位置判', () => {
        expect(resolveDragDisposition({ ...base, offset: 100, velocity: 500, travel: 100 })).toBe('settle')
        expect(resolveDragDisposition({ ...base, offset: 100, velocity: -500, travel: 100 })).toBe('settle')
    })
})
