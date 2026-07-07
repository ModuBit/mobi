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

import { describe, expect, it } from 'vitest'
import { isSearchQuery, parseRipgrepOutput, pathMatchesQuery, applyTypeFilter } from '@/modules/common/handlers/sessionFiles'

describe('isSearchQuery', () => {
    it('普通文件名应触发搜索', () => {
        expect(isSearchQuery('plan')).toBe(true)
    })

    it('带路径分隔符的文件名应触发搜索', () => {
        expect(isSearchQuery('docs/plan')).toBe(true)
    })

    it('点号应走目录浏览', () => {
        expect(isSearchQuery('.')).toBe(false)
    })

    it('空字符串不触发搜索', () => {
        expect(isSearchQuery('')).toBe(false)
    })

    it('包含父级引用不触发搜索', () => {
        expect(isSearchQuery('../plan')).toBe(false)
    })

    it('双点号不触发搜索', () => {
        expect(isSearchQuery('..')).toBe(false)
    })

    it('绝对路径不触发搜索', () => {
        expect(isSearchQuery('/home/user')).toBe(false)
    })

    it('/tmp 不触发搜索', () => {
        expect(isSearchQuery('/tmp')).toBe(false)
    })

    it('~ 开头不触发搜索', () => {
        expect(isSearchQuery('~')).toBe(false)
        expect(isSearchQuery('~/')).toBe(false)
        expect(isSearchQuery('~/Documents')).toBe(false)
    })
})

describe('parseRipgrepOutput', () => {
    it('解析多行输出', () => {
        const output = 'src/index.ts\nsrc/utils/helper.ts\nREADME.md\n'
        const result = parseRipgrepOutput(output, 50)

        expect(result).toHaveLength(3)
        expect(result[0]).toEqual({
            name: 'index.ts',
            type: 'file',
            path: 'src/index.ts'
        })
        expect(result[1]).toEqual({
            name: 'helper.ts',
            type: 'file',
            path: 'src/utils/helper.ts'
        })
        expect(result[2]).toEqual({
            name: 'README.md',
            type: 'file',
            path: 'README.md'
        })
    })

    it('限制返回条目数', () => {
        const lines = Array.from({ length: 100 }, (_, i) => `file_${i}.ts`)
        const output = lines.join('\n') + '\n'
        const result = parseRipgrepOutput(output, 50)

        expect(result).toHaveLength(50)
    })

    it('空字符串返回空数组', () => {
        const result = parseRipgrepOutput('', 50)
        expect(result).toEqual([])
    })
})

describe('pathMatchesQuery', () => {
    it('单段匹配', () => {
        expect(pathMatchesQuery('docs/conventions/hub.md', ['hub'])).toBe(true)
    })

    it('多段有序匹配', () => {
        expect(pathMatchesQuery('docs/conventions/hub.md', ['docs', 'hub'])).toBe(true)
    })

    it('多段顺序不对不匹配', () => {
        expect(pathMatchesQuery('docs/conventions/hub.md', ['hub', 'docs'])).toBe(false)
    })

    it('段不存在不匹配', () => {
        expect(pathMatchesQuery('docs/conventions/hub.md', ['docs', 'xyz'])).toBe(false)
    })

    it('单段部分匹配目录名', () => {
        expect(pathMatchesQuery('docs/conventions/cli.md', ['conv'])).toBe(true)
    })

    it('路径段跨层级匹配', () => {
        expect(pathMatchesQuery('packages/cli/src/index.ts', ['cli', 'index'])).toBe(true)
    })
})

describe('applyTypeFilter', () => {
    const dirs = [
        { name: 'src', type: 'directory' as const, path: 'src' },
        { name: 'docs', type: 'directory' as const, path: 'docs' },
    ]
    const files = [
        { name: 'a.ts', type: 'file' as const, path: 'src/a.ts' },
        { name: 'b.ts', type: 'file' as const, path: 'b.ts' },
    ]

    it('type=file → 仅文件', () => {
        expect(applyTypeFilter(dirs, files, 'file')).toEqual(files)
    })

    it('type=directory → 仅目录', () => {
        expect(applyTypeFilter(dirs, files, 'directory')).toEqual(dirs)
    })

    it('type 不传 → 目录 + 文件合并', () => {
        expect(applyTypeFilter(dirs, files)).toEqual([...dirs, ...files])
    })

    it('合并结果受 MAX_RESULTS(50) 截断', () => {
        const manyDirs = Array.from({ length: 30 }, (_, i) => ({ name: `d${i}`, type: 'directory' as const, path: `d${i}` }))
        const manyFiles = Array.from({ length: 30 }, (_, i) => ({ name: `f${i}.ts`, type: 'file' as const, path: `f${i}.ts` }))
        expect(applyTypeFilter(manyDirs, manyFiles)).toHaveLength(50)
    })

    it('type=directory 超量也截断到 50', () => {
        const manyDirs = Array.from({ length: 60 }, (_, i) => ({ name: `d${i}`, type: 'directory' as const, path: `d${i}` }))
        expect(applyTypeFilter(manyDirs, [], 'directory')).toHaveLength(50)
    })
})
