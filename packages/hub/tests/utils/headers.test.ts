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

import { describe, test, expect } from 'bun:test'
import { safeDecodeHeader } from '../../src/web/utils/headers'

describe('safeDecodeHeader', () => {
    test('合法 URL 编码 → 正确解码', () => {
        expect(safeDecodeHeader('test%20file.png')).toBe('test file.png')
        expect(safeDecodeHeader('%E4%B8%AD%E6%96%87.txt')).toBe('中文.txt')
    })

    test('null/undefined/空 → 空串', () => {
        expect(safeDecodeHeader(null)).toBe('')
        expect(safeDecodeHeader(undefined)).toBe('')
        expect(safeDecodeHeader('')).toBe('')
    })

    test('非法 % 序列 → 空串（不抛 URIError，端点按缺失走 400）', () => {
        expect(safeDecodeHeader('%zz')).toBe('')
        expect(safeDecodeHeader('file%')).toBe('')
        expect(safeDecodeHeader('100%done.png')).toBe('')
    })

    test('无编码字符 → 原样返回', () => {
        expect(safeDecodeHeader('plain.png')).toBe('plain.png')
    })
})
