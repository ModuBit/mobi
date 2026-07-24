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
import { basename, normalizeDirectoryPath, truncatePathLeft, relativePath, encodePathSegments } from '@/core/utils/path'

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

describe('relativePath', () => {
    it('cwd 内正常相对', () => {
        expect(relativePath('/proj', '/proj/output/index.html')).toEqual({ ok: true, rel: 'output/index.html' })
    })
    it('filePath 等于 cwd（是目录非文件）→ ok:false', () => {
        expect(relativePath('/proj', '/proj')).toEqual({ ok: false })
    })
    it('filePath 在 cwd 外 → ok:false（越界，不发请求）', () => {
        expect(relativePath('/proj', '/etc/passwd')).toEqual({ ok: false })
        expect(relativePath('/proj', '/proj/../etc')).toEqual({ ok: false })
    })
    it('前缀同名但非目录前缀 → ok:false（/project 不在 /proj）', () => {
        expect(relativePath('/proj', '/project/x')).toEqual({ ok: false })
    })
    it('Windows 分隔符归一', () => {
        expect(relativePath('C:\\proj', 'C:\\proj\\a.html')).toEqual({ ok: true, rel: 'a.html' })
    })
    it('base 或 file 为空 → ok:false', () => {
        expect(relativePath('', '/proj/x')).toEqual({ ok: false })
        expect(relativePath('/proj', '')).toEqual({ ok: false })
    })
})

describe('encodePathSegments', () => {
    it('保留 / 分隔,每段 encode', () => {
        expect(encodePathSegments('output/a b/样式.css')).toBe('output/a%20b/%E6%A0%B7%E5%BC%8F.css')
    })
    it('单段无 /', () => {
        expect(encodePathSegments('index.html')).toBe('index.html')
    })
})
