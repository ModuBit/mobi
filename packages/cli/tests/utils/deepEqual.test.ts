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

// Characterization tests for utils/deepEqual.ts —— 锁定现有行为
// 收窄 any→unknown 前后这些断言必须保持绿
import { describe, it, expect } from 'vitest'
import { deepEqual } from '@/utils/deepEqual'

describe('deepEqual (utils)', () => {
    it('原始值相等', () => {
        expect(deepEqual(1, 1)).toBe(true)
        expect(deepEqual('x', 'x')).toBe(true)
        expect(deepEqual(true, true)).toBe(true)
    })

    it('原始值不等', () => {
        expect(deepEqual(1, 2)).toBe(false)
        expect(deepEqual('x', 'y')).toBe(false)
    })

    it('引用相等直接返回 true', () => {
        const o = { a: 1 }
        expect(deepEqual(o, o)).toBe(true)
    })

    it('null 与 null 相等', () => {
        expect(deepEqual(null, null)).toBe(true)
    })

    it('一侧为 null/undefined 不等', () => {
        expect(deepEqual(null, {})).toBe(false)
        expect(deepEqual({}, null)).toBe(false)
        expect(deepEqual(undefined, {})).toBe(false)
    })

    it('一侧为非对象（原始值）不等', () => {
        expect(deepEqual('x', {})).toBe(false)
        expect(deepEqual({}, 'x')).toBe(false)
    })

    it('嵌套对象深度相等（忽略 key 顺序）', () => {
        expect(deepEqual({ a: { b: 1 } }, { a: { b: 1 } })).toBe(true)
        expect(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true)
    })

    it('key 数量不同不等', () => {
        expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false)
    })

    it('key 集合不同不等', () => {
        expect(deepEqual({ a: 1 }, { b: 1 })).toBe(false)
    })

    it('数组按索引比较（不排序）', () => {
        expect(deepEqual([1, 2, 3], [1, 2, 3])).toBe(true)
        expect(deepEqual([1, 2, 3], [3, 2, 1])).toBe(false)
    })
})
