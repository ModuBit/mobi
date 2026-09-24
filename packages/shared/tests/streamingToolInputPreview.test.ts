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
import {
    buildStreamingToolInputPreview,
    parseCompleteJson,
    STREAMING_PREVIEW_MAX_RAW_LENGTH,
    STREAMING_PREVIEW_MAX_FIELD_LENGTH,
} from '../src/streamingToolInputPreview'

describe('parseCompleteJson', () => {
    it('完整 JSON 解析成功', () => {
        expect(parseCompleteJson('{"command":"ls -la"}')).toEqual({ ok: true, value: { command: 'ls -la' } })
    })

    it('半截 JSON 返回 not-ok', () => {
        expect(parseCompleteJson('{"command": "npm ru').ok).toBe(false)
    })

    it('空串返回 not-ok', () => {
        expect(parseCompleteJson('').ok).toBe(false)
    })

    it('非 JSON 垃圾返回 not-ok', () => {
        expect(parseCompleteJson('not json at all').ok).toBe(false)
        expect(parseCompleteJson('garbage').ok).toBe(false)
    })
})

describe('buildStreamingToolInputPreview', () => {
    it('完整 JSON 直接完整解析（complete=true）', () => {
        const result = buildStreamingToolInputPreview('{"file_path":"/a/b.ts","content":"x"}')
        expect(result).toEqual({ input: { file_path: '/a/b.ts', content: 'x' }, complete: true })
    })

    it('半截 JSON：提取已闭合的白名单字段', () => {
        // Write 场景：file_path 已闭合、content 正在生成
        const result = buildStreamingToolInputPreview('{"file_path":"/src/foo.ts","content":"const a = 1;\\n')
        expect(result.complete).toBe(false)
        expect(result.input).toEqual({ file_path: '/src/foo.ts' })
    })

    it('半截 JSON：白名单字段值未闭合时不提取', () => {
        const result = buildStreamingToolInputPreview('{"command": "npm ru')
        expect(result.complete).toBe(false)
        expect(result.input).toEqual({})
    })

    it('多字段：依次提取各自已闭合的值（Bash 场景）', () => {
        const result = buildStreamingToolInputPreview('{"description":"run tests","command":"bun test","timeout": 120')
        expect(result.complete).toBe(false)
        expect(result.input).toEqual({ description: 'run tests', command: 'bun test' })
    })

    it('字段值含转义引号与转义换行时正确读取到真实闭合位', () => {
        // JSON 源文本：{"command":"echo \"hi\n","description":"x  （值里含 \" 与 \n 转义）
        const raw = '{"command":"echo \\"hi\\n","description":"x'
        const result = buildStreamingToolInputPreview(raw)
        expect(result.input).toEqual({ command: 'echo "hi\n' })
    })

    it('非白名单字段不提取（大 payload 隔离）', () => {
        const result = buildStreamingToolInputPreview('{"content":"big payload","new_string":"diff text"')
        expect(result.input).toEqual({})
    })

    it('白名单字段出现在大 payload 字段之后仍能提取', () => {
        // 理论上 file_path 排在 content 前，但解析器不依赖顺序
        const result = buildStreamingToolInputPreview('{"content":"xxx","file_path":"/a.ts"')
        expect(result.input).toEqual({ file_path: '/a.ts' })
    })

    it('字段值超长截断到上限', () => {
        const longCommand = 'x'.repeat(STREAMING_PREVIEW_MAX_FIELD_LENGTH + 100)
        const result = buildStreamingToolInputPreview(`{"command":"${longCommand}"`)
        const input = result.input as { command: string }
        expect(input.command).toHaveLength(STREAMING_PREVIEW_MAX_FIELD_LENGTH)
    })

    it(`rawInput 超过 ${STREAMING_PREVIEW_MAX_RAW_LENGTH} 字节后放弃解析（回退空预览）`, () => {
        // content 巨大：JSON 不完整、总体积超预算、且白名单字段在 8KB 之后（模拟放弃场景）
        const raw = `{"content":"${'y'.repeat(STREAMING_PREVIEW_MAX_RAW_LENGTH + 10)}","file_path":"/a.ts"`
        const result = buildStreamingToolInputPreview(raw)
        expect(result.complete).toBe(false)
        expect(result.input).toEqual({})
    })

    it('非 JSON 垃圾前缀返回空预览', () => {
        const result = buildStreamingToolInputPreview('garbage input')
        expect(result.complete).toBe(false)
        expect(result.input).toEqual({})
    })

    it('plan 字段（ExitPlanMode 场景）提取', () => {
        // 值已闭合，但顶层 JSON 未完成（缺 }）——仍走半截提取
        const result = buildStreamingToolInputPreview('{"plan":"## 重构方案\\n\\n第一步"')
        expect(result.input).toEqual({ plan: '## 重构方案\n\n第一步' })
    })
})
