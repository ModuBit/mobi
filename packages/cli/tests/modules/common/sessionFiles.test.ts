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
import { isSearchQuery, parseRipgrepOutput } from '@/modules/common/handlers/sessionFiles'

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
