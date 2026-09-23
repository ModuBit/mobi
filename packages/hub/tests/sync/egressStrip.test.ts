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

import { describe, test, expect } from 'bun:test'
import {
    stripEgressContent,
    registerEgressToolName,
    lookupEgressToolName,
    EGRESS_PLACEHOLDER,
    STRIPPED_BASE64_MARKER,
    EGRESS_TRUNCATE_CHARS,
} from '../../src/sync/egressStrip'

// ============ 帧构造 helper ============

/** assistant 帧：携带 tool_use 块（过剥离函数时顺带登记工具名） */
function assistantFrame(toolUseId: string, toolName: string): unknown {
    return {
        role: 'agent',
        content: {
            type: 'text',
            data: {
                uuid: `u-a-${toolUseId}`,
                message: {
                    role: 'assistant',
                    content: [{ type: 'tool_use', id: toolUseId, name: toolName, input: {} }],
                },
            },
        },
    }
}

/** user 帧：携带 tool_result 块（content 为块数组） */
function toolResultFrame(
    toolUseId: string,
    blockContent: unknown,
    opts: { isError?: boolean; toolUseResult?: unknown } = {},
): unknown {
    return {
        role: 'agent',
        content: {
            type: 'text',
            data: {
                uuid: `u-r-${toolUseId}`,
                message: {
                    role: 'user',
                    content: [{
                        type: 'tool_result',
                        tool_use_id: toolUseId,
                        is_error: opts.isError,
                        content: blockContent,
                    }],
                },
                ...(opts.toolUseResult !== undefined ? { tool_use_result: opts.toolUseResult } : {}),
            },
        },
    }
}

/** 从剥离结果中取 tool_result block（信封形状不变，只改 content） */
function resultBlock(stripped: unknown): {
    content: unknown
    is_error?: boolean
    tool_use_id: string
} {
    const frame = stripped as {
        content: { data: { message: { content: Array<{ type: string; content: unknown; is_error?: boolean; tool_use_id: string }> } } }
    }
    const block = frame.content.data.message.content[0]
    expect(block.type).toBe('tool_result')
    return block
}

/** 登记工具名 + 构造 tool_result 帧的快捷方式 */
function frameWithTool(toolUseId: string, toolName: string, blockContent: unknown, opts?: Parameters<typeof toolResultFrame>[2]): unknown {
    registerEgressToolName(toolUseId, toolName)
    return toolResultFrame(toolUseId, blockContent, opts)
}

const longText = (n: number) => 'x'.repeat(n)
const textBlock = (text: string) => [{ type: 'text', text }]

// ============ 策略表 ============

describe('stripEgressContent 策略表', () => {
    test('文件类工具（Read）：content 块数组替换为占位 text block', () => {
        const frame = frameWithTool('tu-read', 'Read', textBlock(longText(50_000)))

        const block = resultBlock(stripEgressContent(frame))

        expect(block.content).toEqual([{ type: 'text', text: EGRESS_PLACEHOLDER }])
    })

    test('文件类工具（Write/Edit/MultiEdit/NotebookRead/NotebookEdit）同样占位', () => {
        for (const name of ['Write', 'Edit', 'MultiEdit', 'NotebookRead', 'NotebookEdit']) {
            const frame = frameWithTool(`tu-${name}`, name, textBlock('secret'))
            expect(resultBlock(stripEgressContent(frame)).content).toEqual([{ type: 'text', text: EGRESS_PLACEHOLDER }])
        }
    })

    test('文件类占位只动 tool_result.content：tool_use_result.structuredPatch 原样保留', () => {
        const tur = { type: 'edit', structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['+new'] }], filePath: '/a.ts' }
        const frame = frameWithTool('tu-patch', 'Edit', textBlock('content'), { toolUseResult: tur })

        const stripped = stripEgressContent(frame) as { content: { data: { tool_use_result: unknown } } }

        expect(resultBlock(stripped).content).toEqual([{ type: 'text', text: EGRESS_PLACEHOLDER }])
        expect(stripped.content.data.tool_use_result).toEqual(tur)
    })

    test('Bash 截断：>2048 字符保留头部 2048', () => {
        const frame = frameWithTool('tu-bash', 'Bash', textBlock(longText(EGRESS_TRUNCATE_CHARS + 100)))

        const block = resultBlock(stripEgressContent(frame))

        expect(block.content).toEqual([{ type: 'text', text: longText(EGRESS_TRUNCATE_CHARS) }])
    })

    test('Bash 边界：恰 2048 原样、2047 原样', () => {
        for (const n of [EGRESS_TRUNCATE_CHARS - 1, EGRESS_TRUNCATE_CHARS]) {
            const frame = frameWithTool(`tu-b-${n}`, 'Bash', textBlock(longText(n)))
            expect(resultBlock(stripEgressContent(frame)).content).toEqual(textBlock(longText(n)))
        }
    })

    test('Bash content 为字符串形态时同样截断', () => {
        const frame = frameWithTool('tu-str', 'Bash', longText(EGRESS_TRUNCATE_CHARS + 5))

        expect(resultBlock(stripEgressContent(frame)).content).toBe(longText(EGRESS_TRUNCATE_CHARS))
    })

    test('Task 族豁免：TaskList/TaskGet/TaskOutput/TaskCreate/TaskUpdate 全量保留', () => {
        for (const name of ['TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet', 'TaskOutput']) {
            const frame = frameWithTool(`tu-${name}`, name, textBlock(longText(50_000)))
            expect(resultBlock(stripEgressContent(frame)).content).toEqual(textBlock(longText(50_000)))
        }
    })

    test('is_error 豁免：失败结果全量保留（即使超长）', () => {
        const frame = frameWithTool('tu-err', 'Bash', textBlock(longText(50_000)), { isError: true })

        expect(resultBlock(stripEgressContent(frame)).content).toEqual(textBlock(longText(50_000)))
    })

    test('mcp__ 工具截断', () => {
        const frame = frameWithTool('tu-mcp', 'mcp__chrome__click', textBlock(longText(EGRESS_TRUNCATE_CHARS + 1)))

        expect(resultBlock(stripEgressContent(frame)).content).toEqual([{ type: 'text', text: longText(EGRESS_TRUNCATE_CHARS) }])
    })

    test('未注册工具名（冷表/老消息）按截断兜底', () => {
        const frame = toolResultFrame('tu-cold', textBlock(longText(EGRESS_TRUNCATE_CHARS + 1)))

        expect(resultBlock(stripEgressContent(frame)).content).toEqual([{ type: 'text', text: longText(EGRESS_TRUNCATE_CHARS) }])
    })

    test('块数组截断：保留块结构，text 按预算依次截断', () => {
        const frame = frameWithTool('tu-multi', 'Bash', [
            { type: 'text', text: 'a'.repeat(1500) },
            { type: 'text', text: 'b'.repeat(1500) },
        ])

        const block = resultBlock(stripEgressContent(frame))

        expect(block.content).toEqual([
            { type: 'text', text: 'a'.repeat(1500) },
            { type: 'text', text: 'b'.repeat(548) },
        ])
    })

    test('块数组截断：非 text 块（image）原样保留，不计入字符预算', () => {
        const imageBlock = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'Z'.repeat(5000) } }
        const frame = frameWithTool('tu-img', 'Bash', [
            imageBlock,
            { type: 'text', text: longText(EGRESS_TRUNCATE_CHARS + 10) },
        ])

        const raw = JSON.stringify(stripEgressContent(frame))
        const block = resultBlock(stripEgressContent(frame))

        expect(raw).toContain(STRIPPED_BASE64_MARKER)
        expect(raw).not.toContain('Z'.repeat(5000))
        expect((block.content as unknown[])[0]).toEqual({
            type: 'image',
            source: { type: 'base64', media_type: 'image/png', data: STRIPPED_BASE64_MARKER },
        })
        expect((block.content as unknown[])[1]).toEqual({ type: 'text', text: longText(EGRESS_TRUNCATE_CHARS) })
    })
})

// ============ base64 剥离（收编 stripHeavyImagePayload）============

describe('stripEgressContent base64 剥离', () => {
    test('tool_result image block source.data 与 tool_use_result.file.base64 均剥离', () => {
        const BIG = 'iVBORw0KGgo' + 'A'.repeat(200_000)
        const frame = {
            role: 'agent',
            content: {
                type: 'text',
                data: {
                    uuid: 'u-img',
                    message: {
                        role: 'user',
                        content: [{
                            type: 'tool_result',
                            tool_use_id: 'tu-img',
                            content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: BIG } }],
                        }],
                    },
                    tool_use_result: { type: 'image', file: { base64: BIG, type: 'image/png', originalSize: 100, dimensions: {} } },
                },
            },
        }

        const raw = JSON.stringify(stripEgressContent(frame))

        expect(raw).not.toContain(BIG)
        expect(raw).toContain(STRIPPED_BASE64_MARKER)
    })
})

// ============ 工具名登记（assistant 消息过出口顺带喂饱注册表）============

describe('stripEgressContent 工具名登记', () => {
    test('assistant 帧中的 tool_use 被登记，后续 tool_result 据此走文件类占位', () => {
        const assistant = assistantFrame('tu-flow', 'Read')
        const strippedAssistant = stripEgressContent(assistant)
        // assistant 消息本身不命中任何剥离规则 → 原引用返回
        expect(strippedAssistant).toBe(assistant)
        expect(lookupEgressToolName('tu-flow')).toBe('Read')

        const frame = toolResultFrame('tu-flow', textBlock(longText(50_000)))
        expect(resultBlock(stripEgressContent(frame)).content).toEqual([{ type: 'text', text: EGRESS_PLACEHOLDER }])
    })
})

// ============ 不可变与零拷贝 ============

describe('stripEgressContent 不可变', () => {
    test('命中剥离时返回新对象，入参原对象不被变异', () => {
        const frame = frameWithTool('tu-imm', 'Read', textBlock(longText(50_000)))
        const snapshot = JSON.stringify(frame)

        const stripped = stripEgressContent(frame)

        expect(stripped).not.toBe(frame)
        expect(JSON.stringify(frame)).toBe(snapshot)
    })

    test('无 tool_result 的消息返回原引用（零拷贝直通）', () => {
        const plain = {
            role: 'agent',
            content: { type: 'text', data: { uuid: 'u', message: { role: 'assistant', content: [{ type: 'text', text: 'hello' }] } } },
        }

        expect(stripEgressContent(plain)).toBe(plain)
    })

    test('非信封形态（string / 裸对象）原样返回', () => {
        expect(stripEgressContent('plain string')).toBe('plain string')
        expect(stripEgressContent(null)).toBe(null)
        expect(stripEgressContent({ foo: 'bar' })).toEqual({ foo: 'bar' })
    })
})

// ============ 工具名 LRU 注册表 ============

describe('egress tool name registry', () => {
    test('未登记返回 null', () => {
        expect(lookupEgressToolName('tu-never')).toBeNull()
    })

    test('重复登记覆盖旧值', () => {
        registerEgressToolName('tu-dup', 'Read')
        registerEgressToolName('tu-dup', 'Bash')
        expect(lookupEgressToolName('tu-dup')).toBe('Bash')
    })
})
