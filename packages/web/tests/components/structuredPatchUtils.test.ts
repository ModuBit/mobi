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
 * structuredPatch → 渲染行 纯函数测试
 * 格式依据真实转录实证：CC 的 structuredPatch.lines 为 unified 前缀（' '/'-'/'+'）+ 原行内容，
 * 前缀后无分隔空格；空行 context 为单个空格
 */
import { describe, it, expect } from 'vitest'
import { parseStructuredPatchRows } from '@/components/tool-card/views/structuredPatchUtils'

describe('parseStructuredPatchRows', () => {
    it('行号从 oldStart/newStart 起算（Edit 片段位于文件中段）', () => {
        const rows = parseStructuredPatchRows([{
            oldStart: 193,
            oldLines: 4,
            newStart: 193,
            newLines: 4,
            lines: [
                '     context A',   // context：new 193
                '-    old line',    // removed：old 194
                '+    new line',    // added：new 194
                '     context B',   // context：new 195
            ],
        }])

        expect(rows).toEqual([
            { value: '    context A', lineNum: 193 },
            { value: '    old line', removed: true, lineNum: 194 },
            { value: '    new line', added: true, lineNum: 194 },
            { value: '    context B', lineNum: 195 },
        ])
    })

    it('removed 行不推进 new 行号、added 行不推进 old 行号', () => {
        const rows = parseStructuredPatchRows([{
            oldStart: 10,
            oldLines: 6,
            newStart: 10,
            newLines: 8,
            lines: [
                '-    a',   // old 10
                '-    b',   // old 11
                '+    c',   // new 10
                '+    d',   // new 11
                '+    e',   // new 12
                '     f',   // new 13（old 12）
            ],
        }])

        expect(rows.map((r) => r.lineNum)).toEqual([10, 11, 10, 11, 12, 13])
        expect(rows.map((r) => r.removed ?? r.added ?? false)).toEqual([true, true, true, true, true, false])
    })

    it('多 patch（MultiEdit）顺序拼接，各自行号独立起算', () => {
        const rows = parseStructuredPatchRows([
            {
                oldStart: 5,
                oldLines: 2,
                newStart: 5,
                newLines: 3,
                lines: ['-    x', '+    y', '     z'],
            },
            {
                oldStart: 20,
                oldLines: 1,
                newStart: 21,
                newLines: 1,
                lines: ['-    p', '+    q'],
            },
        ])

        expect(rows).toEqual([
            { value: '    x', removed: true, lineNum: 5 },
            { value: '    y', added: true, lineNum: 5 },
            { value: '    z', lineNum: 6 },
            { value: '    p', removed: true, lineNum: 20 },
            { value: '    q', added: true, lineNum: 21 },
        ])
    })

    it('空行 context：单个空格解析为空字符串，仍占行号', () => {
        const rows = parseStructuredPatchRows([{
            oldStart: 1,
            oldLines: 3,
            newStart: 1,
            newLines: 3,
            lines: ['+    first', ' ', '+    after-blank'],
        }])

        expect(rows).toEqual([
            { value: '    first', added: true, lineNum: 1 },
            { value: '', lineNum: 2 },
            { value: '    after-blank', added: true, lineNum: 3 },
        ])
    })

    it('Write create 全新增行：从 newStart 起算', () => {
        const rows = parseStructuredPatchRows([{
            oldStart: 0,
            oldLines: 0,
            newStart: 1,
            newLines: 2,
            lines: ['+    line one', '+    line two'],
        }])

        expect(rows).toEqual([
            { value: '    line one', added: true, lineNum: 1 },
            { value: '    line two', added: true, lineNum: 2 },
        ])
    })
})
