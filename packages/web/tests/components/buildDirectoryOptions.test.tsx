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
import { render } from '@testing-library/react'
import { buildDirectoryAutoCompleteOptions } from '@/components/composer/EnvironmentBar'
import type { DirectoryOption } from '@/components/session/useMachineDirectoryListing'

describe('buildDirectoryAutoCompleteOptions', () => {
    it('空输入返回 homeDir + 最近路径（homeDir 置顶）', () => {
        const opts = buildDirectoryAutoCompleteOptions('', ['/a', '/b'], [], '/home/user')
        expect(opts.map(o => o.value)).toEqual(['/home/user', '/a', '/b'])
    })

    it('空输入时过滤掉与 homeDir 重复的最近路径', () => {
        const opts = buildDirectoryAutoCompleteOptions('', ['/a', '/home/user'], [], '/home/user')
        expect(opts.map(o => o.value)).toEqual(['/home/user', '/a'])
    })

    it('空输入时最近路径最多取 5 条', () => {
        const recents = ['/r1', '/r2', '/r3', '/r4', '/r5', '/r6', '/r7']
        const opts = buildDirectoryAutoCompleteOptions('', recents, [])
        // 无 homeDir，全部来自最近路径，截断到 5
        expect(opts).toHaveLength(5)
        expect(opts.map(o => o.value)).toEqual(['/r1', '/r2', '/r3', '/r4', '/r5'])
    })

    it('有输入时透传 directoryOptions 的 value', () => {
        const dirOpts: DirectoryOption[] = [
            { value: '/foo/bar', label: 'bar' },
            { value: '/foo/baz', label: 'baz' },
        ]
        const opts = buildDirectoryAutoCompleteOptions('/foo', [], dirOpts)
        expect(opts.map(o => o.value)).toEqual(['/foo/bar', '/foo/baz'])
    })

    it('有输入但无 directoryOptions 时返回空数组', () => {
        const opts = buildDirectoryAutoCompleteOptions('/foo', [], [])
        expect(opts).toEqual([])
    })

    it('前缀匹配时高亮渲染：文本完整 + 含加粗段', () => {
        // /foo/ba → label 'bar' 前缀 'ba' 匹配，拆成 'ba'(加粗) + 'r'
        const opts = buildDirectoryAutoCompleteOptions('/foo/ba', [], [
            { value: '/foo/bar', label: 'bar' },
        ])
        const { container } = render(opts[0].label as React.ReactElement)
        expect(container.textContent).toBe('bar')
        // 存在加粗（fontWeight 600）的高亮 span
        const bold = container.querySelector('span[style*="font-weight: 600"], span[style*="font-weight:600"]')
        expect(bold).not.toBeNull()
        expect(bold?.textContent).toBe('ba')
    })
})
