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
import { basename, normalizeDirectoryPath, truncatePathLeft } from '@/core/utils/path'

describe('path utils', () => {
    describe('basename', () => {
        it('should return the file name from a path', () => {
            expect(basename('/a/b/c/file.ts')).toBe('file.ts')
            expect(basename('file.ts')).toBe('file.ts')
            expect(basename('/file.ts')).toBe('file.ts')
        })

        it('should handle Windows paths', () => {
            expect(basename('C:\\a\\b\\file.ts')).toBe('file.ts')
        })
    })

    describe('normalizeDirectoryPath', () => {
        it('应去除尾部斜杠（含多个）', () => {
            expect(normalizeDirectoryPath('/a/b/')).toBe('/a/b')
            expect(normalizeDirectoryPath('/a/b///')).toBe('/a/b')
        })

        it('无尾斜杠的路径保持不变', () => {
            expect(normalizeDirectoryPath('/a/b')).toBe('/a/b')
        })

        it('根路径保留为 /', () => {
            expect(normalizeDirectoryPath('/')).toBe('/')
            expect(normalizeDirectoryPath('//')).toBe('/')
        })

        it('空字符串原样返回', () => {
            expect(normalizeDirectoryPath('')).toBe('')
        })

        it('兼容反斜杠与混合尾分隔符', () => {
            expect(normalizeDirectoryPath('C:\\a\\b\\')).toBe('C:\\a\\b')
            expect(normalizeDirectoryPath('/a/b\\')).toBe('/a/b')
        })
    })

    describe('truncatePathLeft', () => {
        it('should not truncate short paths', () => {
            expect(truncatePathLeft('file.ts', 50)).toBe('file.ts')
            expect(truncatePathLeft('src/file.ts', 50)).toBe('src/file.ts')
        })

        it('should truncate long paths from the left', () => {
            const path = 'a/b/c/d/e/f/g/h/file.ts'
            const result = truncatePathLeft(path, 20)
            expect(result.startsWith('...')).toBe(true)
            expect(result.length).toBe(20)
            expect(result.endsWith('file.ts')).toBe(true)
        })

        it('should preserve file name when truncating', () => {
            const path = 'very/long/path/to/some/deep/directory/structure/file.ts'
            const result = truncatePathLeft(path, 30)
            expect(result.includes('file.ts')).toBe(true)
        })

        it('should handle very long file names', () => {
            const path = 'a/b/very-long-file-name-that-exceeds-limit.ts'
            const result = truncatePathLeft(path, 20)
            expect(result.startsWith('...')).toBe(true)
            expect(result.length).toBe(20)
        })

        it('should handle single file name', () => {
            expect(truncatePathLeft('short.ts', 20)).toBe('short.ts')
            const result = truncatePathLeft('very-long-file-name.ts', 15)
            expect(result.startsWith('...')).toBe(true)
            expect(result.length).toBe(15)
        })
    })
})
