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
import { commonDirectoryPrefix } from '@/core/utils/pathTree'

describe('commonDirectoryPrefix', () => {
    it('空输入返回空串', () => {
        expect(commonDirectoryPrefix([])).toBe('')
    })

    it('单文件返回其所在目录', () => {
        expect(commonDirectoryPrefix(['a/b/c.ts'])).toBe('a/b/')
    })

    it('公共目录前缀含结尾斜杠', () => {
        expect(commonDirectoryPrefix(['/w/proj/src/a.ts', '/w/proj/src/agent/b.ts', '/w/proj/src/x/y.ts'])).toBe('/w/proj/src/')
    })

    it('部分段相同不并入（前缀按完整段对齐）', () => {
        expect(commonDirectoryPrefix(['src/ab.ts', 'src/ac.ts'])).toBe('src/')
    })

    it('根目录散文件无公共目录', () => {
        expect(commonDirectoryPrefix(['a.ts', 'b.ts'])).toBe('')
    })

    it('目录分叉返回空串', () => {
        expect(commonDirectoryPrefix(['a/x.ts', 'b/y.ts'])).toBe('')
    })

    it('绝对与相对路径混排无公共目录', () => {
        expect(commonDirectoryPrefix(['/w/proj/a.ts', 'proj/b.ts'])).toBe('')
    })
})
