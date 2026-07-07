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
import { formatFileSize } from '@/core/utils/fileSize'

describe('formatFileSize', () => {
    it('0 → "0 B"', () => {
        expect(formatFileSize(0)).toBe('0 B')
    })

    it('小于 1024 → 整数 B', () => {
        expect(formatFileSize(1)).toBe('1.0 B')
        expect(formatFileSize(512)).toBe('512 B')
    })

    it('小于 10 的单位 → 1 位小数', () => {
        expect(formatFileSize(1024)).toBe('1.0 KB')
        expect(formatFileSize(1536)).toBe('1.5 KB')
        expect(formatFileSize(9216)).toBe('9.0 KB')
    })

    it('≥10 的单位 → 取整', () => {
        expect(formatFileSize(10240)).toBe('10 KB')
        expect(formatFileSize(102400)).toBe('100 KB')
    })

    it('MB / GB 跨档', () => {
        expect(formatFileSize(1024 * 1024)).toBe('1.0 MB')
        expect(formatFileSize(1024 * 1024 * 1024)).toBe('1.0 GB')
    })

    it('超 GB 上限不再升档（最大 GB）', () => {
        expect(formatFileSize(2048 * 1024 * 1024 * 1024)).toBe('2048 GB')
    })

    it('负数 / NaN / Infinity → "0 B"（兜底，避免 NaN undefined）', () => {
        expect(formatFileSize(-1)).toBe('0 B')
        expect(formatFileSize(-1024)).toBe('0 B')
        expect(formatFileSize(NaN)).toBe('0 B')
        expect(formatFileSize(Infinity)).toBe('0 B')
    })
})
