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
import { calculateLineNumWidth, getMaxLineNum, calculateDiffStats, formatDiffStats } from '@/components/tool-card/views/lineNumberUtils'

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

    describe('calculateDiffStats', () => {
        it('should return zero stats for empty strings', () => {
            const stats = calculateDiffStats('', '')
            expect(stats.added).toBe(0)
            expect(stats.removed).toBe(0)
            expect(stats.unchanged).toBe(0)
        })

        it('should calculate stats for adding lines', () => {
            const stats = calculateDiffStats('', 'line1\nline2\nline3')
            expect(stats.added).toBe(3)
            expect(stats.removed).toBe(0)
            expect(stats.unchanged).toBe(0)
        })

        it('should calculate stats for removing lines', () => {
            const stats = calculateDiffStats('line1\nline2\nline3', '')
            expect(stats.added).toBe(0)
            expect(stats.removed).toBe(3)
            expect(stats.unchanged).toBe(0)
        })

        it('should calculate stats for equal content', () => {
            const stats = calculateDiffStats('line1\nline2', 'line1\nline2')
            expect(stats.added).toBe(0)
            expect(stats.removed).toBe(0)
            expect(stats.unchanged).toBe(2)
        })

        it('should calculate stats for adding more lines', () => {
            const stats = calculateDiffStats('line1', 'line1\nline2\nline3')
            expect(stats.added).toBe(2)
            expect(stats.removed).toBe(0)
            expect(stats.unchanged).toBe(1)
        })

        it('should calculate stats for removing lines', () => {
            const stats = calculateDiffStats('line1\nline2\nline3', 'line1')
            expect(stats.added).toBe(0)
            expect(stats.removed).toBe(2)
            expect(stats.unchanged).toBe(1)
        })

        it('should calculate stats for both additions and removals', () => {
            const stats = calculateDiffStats('line1\nline2\nline3', 'line1\nnewLine\nline3')
            expect(stats.added).toBe(1)
            expect(stats.removed).toBe(1)
            expect(stats.unchanged).toBe(2)
        })

        it('should calculate stats for replacing content', () => {
            const stats = calculateDiffStats('old1\nold2', 'new1\nnew2')
            expect(stats.added).toBe(2)
            expect(stats.removed).toBe(2)
            expect(stats.unchanged).toBe(0)
        })

        it('should handle single line changes', () => {
            const stats = calculateDiffStats('hello', 'world')
            expect(stats.added).toBe(1)
            expect(stats.removed).toBe(1)
            expect(stats.unchanged).toBe(0)
        })
    })

    describe('formatDiffStats', () => {
        it('should format write stats', () => {
            expect(formatDiffStats({ added: 5, removed: 0, unchanged: 0 }, 'write')).toBe('wrote 5 lines')
            expect(formatDiffStats({ added: 1, removed: 0, unchanged: 0 }, 'write')).toBe('wrote 1 line')
        })

        it('should format edit stats with additions', () => {
            expect(formatDiffStats({ added: 3, removed: 0, unchanged: 2 }, 'edit')).toBe('added 3 lines')
            expect(formatDiffStats({ added: 1, removed: 0, unchanged: 2 }, 'edit')).toBe('added 1 line')
        })

        it('should format edit stats with removals', () => {
            expect(formatDiffStats({ added: 0, removed: 3, unchanged: 2 }, 'edit')).toBe('removed 3 lines')
            expect(formatDiffStats({ added: 0, removed: 1, unchanged: 2 }, 'edit')).toBe('removed 1 line')
        })

        it('should format edit stats with both additions and removals', () => {
            expect(formatDiffStats({ added: 2, removed: 3, unchanged: 5 }, 'edit')).toBe('added 2 lines, removed 3 lines')
        })

        it('should format no changes', () => {
            expect(formatDiffStats({ added: 0, removed: 0, unchanged: 5 }, 'edit')).toBe('no changes')
        })
    })
})
