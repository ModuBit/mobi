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

/**
 * structuredPatch → unified patch 文本 合成纯函数测试（工具卡 diff 换 @pierre/diffs 渲染核）
 * 格式依据：库 parser 硬要求 `--- / +++` 文件头；hunk 头 `@@ -o,ol +n,nl @@`；
 * 行体为 unified 前缀 + 原行内容（前缀后无分隔空格）
 */
import { describe, it, expect } from 'vitest'
import { composePatchText, composePatchFromLineRows, countPatchLines, patchForEdit } from '@/components/tool-card/views/structuredPatchUtils'

describe('composePatchText', () => {
    it('单 hunk：带文件头与 hunk 头，行体原样透传', () => {
        const text = composePatchText('src/app.ts', [{
            oldStart: 193,
            oldLines: 3,
            newStart: 193,
            newLines: 3,
            lines: [' const a', '-const old', '+const new'],
        }])

        expect(text).toBe([
            '--- a/src/app.ts',
            '+++ b/src/app.ts',
            '@@ -193,3 +193,3 @@',
            ' const a',
            '-const old',
            '+const new',
        ].join('\n'))
    })

    it('多 hunk（MultiEdit）顺序拼接在同一文件头下', () => {
        const text = composePatchText('x.ts', [
            { oldStart: 5, oldLines: 2, newStart: 5, newLines: 3, lines: ['-a', '+b', ' c'] },
            { oldStart: 20, oldLines: 1, newStart: 21, newLines: 1, lines: ['-p', '+q'] },
        ])

        expect(text.split('\n')).toEqual([
            '--- a/x.ts',
            '+++ b/x.ts',
            '@@ -5,2 +5,3 @@', '-a', '+b', ' c',
            '@@ -20,1 +21,1 @@', '-p', '+q',
        ])
    })

    it('Write 新建：-0,0 起点与中文行原样保留', () => {
        const text = composePatchText('n.txt', [{
            oldStart: 0, oldLines: 0, newStart: 1, newLines: 2,
            lines: ['+你好', '+'],
        }])

        expect(text.split('\n')).toEqual([
            '--- a/n.txt', '+++ b/n.txt',
            '@@ -0,0 +1,2 @@', '+你好', '+',
        ])
    })
})

describe('composePatchFromLineRows（回退合成）', () => {
    it('diffLines 行模型 → 单 hunk：context/删除/新增 计数与行体', () => {
        const text = composePatchFromLineRows('f.ts', [
            { value: 'keep' },
            { value: 'old', removed: true },
            { value: 'new', added: true },
            { value: 'tail' },
        ])

        expect(text.split('\n')).toEqual([
            '--- a/f.ts', '+++ b/f.ts',
            '@@ -1,3 +1,3 @@',
            ' keep', '-old', '+new', ' tail',
        ])
    })

    it('空 old（Write 新建）：-0,0 惯例、全 + 行', () => {
        const text = composePatchFromLineRows('new.txt', [
            { value: 'l1', added: true },
            { value: 'l2', added: true },
        ])

        expect(text.split('\n')).toEqual([
            '--- a/new.txt', '+++ b/new.txt',
            '@@ -0,0 +1,2 @@',
            '+l1', '+l2',
        ])
    })

    it('空行集：合成空串（调用方守卫降级）', () => {
        expect(composePatchFromLineRows('x', [])).toBe('')
    })
})

describe('countPatchLines', () => {
    it('+/− 行计数，context 与多 hunk 累加', () => {
        expect(countPatchLines([
            { oldStart: 1, oldLines: 3, newStart: 1, newLines: 3, lines: [' c', '-x', '+y', '+z'] },
            { oldStart: 9, oldLines: 1, newStart: 9, newLines: 1, lines: ['-w'] },
        ])).toEqual({ added: 2, removed: 2 })
    })
})

describe('patchForEdit', () => {
    const patches = [
        { oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+b'] },
        { oldStart: 9, oldLines: 1, newStart: 9, newLines: 1, lines: ['-c', '+d'] },
    ] as const

    it('按编辑索引取单条（单元素数组形态）', () => {
        expect(patchForEdit(patches as unknown as never[], 1)).toEqual([patches[1]])
    })

    it('越界/缺失返回 undefined', () => {
        expect(patchForEdit(undefined, 0)).toBeUndefined()
        expect(patchForEdit([], 0)).toBeUndefined()
        expect(patchForEdit(patches as unknown as never[], 5)).toBeUndefined()
    })
})
