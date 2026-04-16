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
import { isObject, asString, asNumber, safeStringify } from '../src/utils'

describe('isObject', () => {
    it('普通对象返回 true', () => {
        expect(isObject({})).toBe(true)
        expect(isObject({ key: 'value' })).toBe(true)
    })

    it('null 返回 false', () => {
        expect(isObject(null)).toBe(false)
    })

    it('数组返回 true', () => {
        expect(isObject([])).toBe(true)
        expect(isObject([1, 2, 3])).toBe(true)
    })

    it('原始类型返回 false', () => {
        expect(isObject(undefined)).toBe(false)
        expect(isObject(42)).toBe(false)
        expect(isObject('string')).toBe(false)
        expect(isObject(true)).toBe(false)
        expect(isObject(Symbol('sym'))).toBe(false)
    })
})

describe('asString', () => {
    it('字符串返回原值', () => {
        expect(asString('hello')).toBe('hello')
        expect(asString('')).toBe('')
    })

    it('非字符串返回 null', () => {
        expect(asString(42)).toBeNull()
        expect(asString(null)).toBeNull()
        expect(asString(undefined)).toBeNull()
        expect(asString(true)).toBeNull()
        expect(asString({})).toBeNull()
    })
})

describe('asNumber', () => {
    it('有限数字返回原值', () => {
        expect(asNumber(42)).toBe(42)
        expect(asNumber(0)).toBe(0)
        expect(asNumber(-3.14)).toBe(-3.14)
    })

    it('NaN 返回 null', () => {
        expect(asNumber(NaN)).toBeNull()
    })

    it('Infinity 返回 null', () => {
        expect(asNumber(Infinity)).toBeNull()
        expect(asNumber(-Infinity)).toBeNull()
    })

    it('非数字返回 null', () => {
        expect(asNumber('42')).toBeNull()
        expect(asNumber(null)).toBeNull()
        expect(asNumber(undefined)).toBeNull()
        expect(asNumber(true)).toBeNull()
    })
})

describe('safeStringify', () => {
    it('字符串直接返回', () => {
        expect(safeStringify('hello')).toBe('hello')
        expect(safeStringify('')).toBe('')
    })

    it('对象返回格式化 JSON', () => {
        const result = safeStringify({ a: 1 })
        expect(result).toBe('{\n  "a": 1\n}')
    })

    it('数组返回格式化 JSON', () => {
        const result = safeStringify([1, 2])
        expect(result).toBe('[\n  1,\n  2\n]')
    })

    it('循环引用不抛错', () => {
        const obj: Record<string, unknown> = {}
        obj.self = obj
        // 不应抛错，返回降级字符串
        const result = safeStringify(obj)
        expect(typeof result).toBe('string')
    })
})
