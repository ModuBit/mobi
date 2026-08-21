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
import { spring } from '@/components/motion/presets'

describe('motion spring 预设', () => {
    it('spring.ui：状态切换默认档，轻微 overshoot', () => {
        expect(spring.ui).toEqual({ type: 'spring', duration: 0.35, bounce: 0.25 })
    })
    it('spring.momentum：拖拽释放沉降档', () => {
        expect(spring.momentum).toEqual({ type: 'spring', duration: 0.3, bounce: 0.2 })
    })
    it('spring.gentle：大面积元素档，弹跳收敛', () => {
        expect(spring.gentle).toEqual({ type: 'spring', duration: 0.5, bounce: 0.05 })
    })
    it('预设不得携带 damping/stiffness/mass——会覆盖 duration/bounce 并引入绝对阻尼系数陷阱', () => {
        for (const preset of Object.values(spring)) {
            const p = preset as Record<string, unknown>
            expect(p.damping).toBeUndefined()
            expect(p.stiffness).toBeUndefined()
            expect(p.mass).toBeUndefined()
        }
    })
})
