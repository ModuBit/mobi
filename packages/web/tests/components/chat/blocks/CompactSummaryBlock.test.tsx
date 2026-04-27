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

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'

// Mock navigator before importing any modules
const mockNavigator = {
    language: 'zh-CN',
    languages: ['zh-CN', 'en'],
}

// Setup global navigator mock
beforeAll(() => {
    Object.defineProperty(global, 'navigator', {
        value: mockNavigator,
        writable: true,
    })
})

// 测试 formatTokens 函数（从组件中提取测试）
describe('formatTokens', () => {
    // 复制组件中的函数逻辑进行测试
    function formatTokens(tokens: number): string {
        if (tokens >= 1000) {
            return `${(tokens / 1000).toFixed(1)}k`
        }
        return String(tokens)
    }

    it('should format small numbers without k suffix', () => {
        expect(formatTokens(100)).toBe('100')
        expect(formatTokens(999)).toBe('999')
    })

    it('should format 1000 with k suffix', () => {
        expect(formatTokens(1000)).toBe('1.0k')
    })

    it('should format large numbers with k suffix', () => {
        expect(formatTokens(10000)).toBe('10.0k')
        expect(formatTokens(5000)).toBe('5.0k')
    })

    it('should handle decimal k values', () => {
        expect(formatTokens(1500)).toBe('1.5k')
        expect(formatTokens(2500)).toBe('2.5k')
        expect(formatTokens(2550)).toBe('2.5k') // toFixed(1) rounds down
        expect(formatTokens(2600)).toBe('2.6k')
    })
})

// 测试压缩率计算逻辑
describe('compression ratio calculation', () => {
    function calcCompressionRatio(preTokens: number, postTokens: number): string {
        return preTokens > 0
            ? ((preTokens - postTokens) / preTokens * 100).toFixed(0)
            : '0'
    }

    it('should calculate 80% reduction', () => {
        expect(calcCompressionRatio(10000, 2000)).toBe('80')
    })

    it('should calculate 50% reduction', () => {
        expect(calcCompressionRatio(1000, 500)).toBe('50')
    })

    it('should handle zero preTokens', () => {
        expect(calcCompressionRatio(0, 0)).toBe('0')
    })

    it('should handle same tokens (0% reduction)', () => {
        expect(calcCompressionRatio(1000, 1000)).toBe('0')
    })
})

// 测试 Summary 提取逻辑
describe('summary content extraction', () => {
    function extractSummary(text: string): string {
        const summaryMatch = text.match(/Summary:\n([\s\S]*)/)
        if (summaryMatch) {
            return summaryMatch[1].trim()
        }
        return text
    }

    it('should extract content after Summary:', () => {
        expect(extractSummary('Summary:\nThis is the summary.')).toBe('This is the summary.')
    })

    it('should extract multi-line content', () => {
        expect(extractSummary('Summary:\nLine 1\nLine 2\nLine 3')).toBe('Line 1\nLine 2\nLine 3')
    })

    it('should return full text when no Summary: prefix', () => {
        expect(extractSummary('Just some text')).toBe('Just some text')
    })

    it('should handle empty summary', () => {
        expect(extractSummary('Summary:\n')).toBe('')
    })
})
