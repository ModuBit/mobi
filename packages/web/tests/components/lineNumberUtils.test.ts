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
import { calculateLineNumWidth, getMaxLineNum } from '@/components/tool-card/views/lineNumberUtils'

describe('lineNumberUtils', () => {
    describe('calculateLineNumWidth', () => {
        it('should return minimum width for single digit line numbers', () => {
            expect(calculateLineNumWidth(1)).toBe(40)
            expect(calculateLineNumWidth(9)).toBe(40)
        })

        it('should return minimum width for two digit line numbers', () => {
            expect(calculateLineNumWidth(10)).toBe(40)
            expect(calculateLineNumWidth(99)).toBe(40)
        })

        it('should calculate width for three digit line numbers', () => {
            // 3 digits * 8 + 16 = 40, equals minimum
            expect(calculateLineNumWidth(100)).toBe(40)
            expect(calculateLineNumWidth(999)).toBe(40)
        })

        it('should calculate width for four digit line numbers', () => {
            // 4 digits * 8 + 16 = 48
            expect(calculateLineNumWidth(1000)).toBe(48)
            expect(calculateLineNumWidth(9999)).toBe(48)
        })

        it('should calculate width for five digit line numbers', () => {
            // 5 digits * 8 + 16 = 56
            expect(calculateLineNumWidth(10000)).toBe(56)
            expect(calculateLineNumWidth(99999)).toBe(56)
        })

        it('should calculate width for large line numbers', () => {
            // 6 digits * 8 + 16 = 64
            expect(calculateLineNumWidth(100000)).toBe(64)
            // 7 digits * 8 + 16 = 72
            expect(calculateLineNumWidth(1000000)).toBe(72)
        })
    })

    describe('getMaxLineNum', () => {
        it('should return 1 for empty array', () => {
            expect(getMaxLineNum([])).toBe(1)
        })

        it('should return the line number from single element', () => {
            expect(getMaxLineNum([{ lineNum: 5 }])).toBe(5)
        })

        it('should return the maximum line number from multiple elements', () => {
            expect(getMaxLineNum([{ lineNum: 1 }, { lineNum: 10 }, { lineNum: 5 }])).toBe(10)
        })

        it('should handle null elements', () => {
            expect(getMaxLineNum([null, { lineNum: 5 }])).toBe(5)
        })

        it('should handle undefined elements', () => {
            expect(getMaxLineNum([undefined, { lineNum: 5 }])).toBe(5)
        })

        it('should handle elements without lineNum', () => {
            expect(getMaxLineNum([{}, { lineNum: 5 }])).toBe(5)
        })

        it('should return 1 when all elements have no lineNum', () => {
            expect(getMaxLineNum([null, undefined, {}])).toBe(1)
        })

        it('should return 1 when all lineNums are 0 or undefined', () => {
            expect(getMaxLineNum([{ lineNum: 0 }, { lineNum: undefined }])).toBe(1)
        })

        it('should handle mixed null/undefined/valid elements', () => {
            expect(getMaxLineNum([
                null,
                { lineNum: 100 },
                undefined,
                { lineNum: 50 },
                {},
                { lineNum: 200 }
            ])).toBe(200)
        })
    })
})
