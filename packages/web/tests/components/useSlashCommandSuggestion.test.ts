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
 * slashCommandHelper 纯函数单元测试
 */

import { describe, it, expect } from 'vitest'
import {
    detectSlashAtCursor,
    toCommandSuggestions,
    filterCommands,
} from './useSlashCommandSuggestion.test-helper'
import type { Command } from './useSlashCommandSuggestion.test-helper'

// ========== detectSlashAtCursor ==========

describe('detectSlashAtCursor', () => {
    it('单独 /，光标在末尾 → 触发，filter 为空', () => {
        expect(detectSlashAtCursor('/', 1)).toEqual({ slashIndex: 0, filter: '' })
    })

    it('/help，光标在末尾 → 触发，filter 为 help', () => {
        expect(detectSlashAtCursor('/help', 5)).toEqual({ slashIndex: 0, filter: 'help' })
    })

    it('/help，光标在 / 后 → 触发，filter 为空', () => {
        expect(detectSlashAtCursor('/help', 1)).toEqual({ slashIndex: 0, filter: '' })
    })

    it('/help，光标在 h 后 → 触发，filter 为 h', () => {
        expect(detectSlashAtCursor('/help', 2)).toEqual({ slashIndex: 0, filter: 'h' })
    })

    it('/ 后跟空白不触发', () => {
        expect(detectSlashAtCursor('/ ', 2)).toBeNull()
        expect(detectSlashAtCursor('/\t', 2)).toBeNull()
        expect(detectSlashAtCursor('/ hello', 2)).toBeNull()
    })

    it('/ abc 光标在 abc 后不触发', () => {
        expect(detectSlashAtCursor('/ abc', 5)).toBeNull()
    })

    it('/super abc 光标在 super 后触发', () => {
        expect(detectSlashAtCursor('/super abc', 6)).toEqual({ slashIndex: 0, filter: 'super' })
    })

    it('空字符串不触发', () => {
        expect(detectSlashAtCursor('', 0)).toBeNull()
    })

    it('无 / 不触发', () => {
        expect(detectSlashAtCursor('help', 4)).toBeNull()
    })

    // —— 与 @ mention 一致的宽松触发条件：/ 前为行首或空白即可，不必整段以 / 开头 ——

    it('前导空格的 / 触发（与 @ 一致）', () => {
        expect(detectSlashAtCursor(' /help', 6)).toEqual({ slashIndex: 1, filter: 'help' })
        expect(detectSlashAtCursor(' /', 2)).toEqual({ slashIndex: 1, filter: '' })
    })

    it('段落中间（前一空格）的 / 触发', () => {
        expect(detectSlashAtCursor('foo /help', 9)).toEqual({ slashIndex: 4, filter: 'help' })
        expect(detectSlashAtCursor('foo /he', 7)).toEqual({ slashIndex: 4, filter: 'he' })
    })

    it('换行后的 / 触发', () => {
        expect(detectSlashAtCursor('foo\n/help', 9)).toEqual({ slashIndex: 4, filter: 'help' })
    })

    it('非独立词的 / 不触发（/ 前紧邻非空白字符）', () => {
        expect(detectSlashAtCursor('foo/bar', 7)).toBeNull()
        expect(detectSlashAtCursor('a/b', 3)).toBeNull()
    })

    it('段落中间 / 后跟空白不触发', () => {
        expect(detectSlashAtCursor('foo / bar', 6)).toBeNull()
    })

    it('取光标前最近的独立词 /', () => {
        // 文本 "/a /b"，光标在末尾：最近的 / 是 index 3
        expect(detectSlashAtCursor('/a /b', 5)).toEqual({ slashIndex: 3, filter: 'b' })
    })

    // —— 字符集白名单：仅命令名合法字符（字母/数字/_/-）可触发，避免路径与特殊字符误触发 ——

    it('路径式 / 不触发（与 @ 路径引用区分）', () => {
        expect(detectSlashAtCursor('see /path/to/x', 14)).toBeNull()
        expect(detectSlashAtCursor('/path/to/file', 14)).toBeNull()
    })

    it('含特殊字符的 / 不触发', () => {
        expect(detectSlashAtCursor('/foo(bar)', 10)).toBeNull()
        expect(detectSlashAtCursor('/foo"baz', 8)).toBeNull()
    })

    it('命令名含连字符/下划线触发', () => {
        expect(detectSlashAtCursor('/code-review', 13)).toEqual({ slashIndex: 0, filter: 'code-review' })
        expect(detectSlashAtCursor('/clear_cache', 13)).toEqual({ slashIndex: 0, filter: 'clear_cache' })
    })
})

// ========== toCommandSuggestions ==========

describe('toCommandSuggestions', () => {
    it('空列表返回空数组', () => {
        expect(toCommandSuggestions([])).toEqual([])
    })

    it('单个命令', () => {
        const commands: Command[] = [
            { name: 'help', description: '帮助', argumentHint: '' },
        ]
        const result = toCommandSuggestions(commands)
        expect(result).toHaveLength(1)
        expect(result[0]).toEqual({
            label: '/help',
            value: '/help',
            description: '帮助',
        })
    })

    it('多个命令', () => {
        const commands: Command[] = [
            { name: 'help', description: '帮助', argumentHint: '' },
            { name: 'test', description: '测试', argumentHint: '<arg>' },
        ]
        const result = toCommandSuggestions(commands)
        expect(result).toHaveLength(2)
    })

    it('同名去重（不区分大小写）', () => {
        const commands: Command[] = [
            { name: 'Help', description: '帮助1', argumentHint: '' },
            { name: 'help', description: '帮助2', argumentHint: '' },
        ]
        const result = toCommandSuggestions(commands)
        expect(result).toHaveLength(1)
        expect(result[0]?.description).toBe('帮助1')
    })

    it('name 已有 / 前缀不重复添加', () => {
        const commands: Command[] = [
            { name: '/help', description: '帮助', argumentHint: '' },
        ]
        const result = toCommandSuggestions(commands)
        expect(result[0]?.label).toBe('/help')
        expect(result[0]?.value).toBe('/help')
    })

    it('透传 argumentHint', () => {
        const commands: Command[] = [
            { name: 'commit', description: '提交', argumentHint: '<message>' },
            { name: 'help', description: '帮助', argumentHint: '' },
        ]
        const result = toCommandSuggestions(commands)
        expect(result[0]?.argumentHint).toBe('<message>')
        expect(result[1]?.argumentHint).toBeUndefined()
    })
})

// ========== filterCommands ==========

describe('filterCommands', () => {
    const items = [
        { label: '/help', value: '/help', description: '帮助' },
        { label: '/test', value: '/test', description: '测试' },
        { label: '/deploy', value: '/deploy', description: '部署' },
    ]

    it('空 filter 返回全部', () => {
        expect(filterCommands(items, '')).toHaveLength(3)
    })

    it('按 label 匹配', () => {
        const result = filterCommands(items, 'help')
        expect(result).toHaveLength(1)
        expect(result[0]?.label).toBe('/help')
    })

    it('不区分大小写', () => {
        const result = filterCommands(items, 'HELP')
        expect(result).toHaveLength(1)
        expect(result[0]?.label).toBe('/help')
    })

    it('contains 匹配', () => {
        const result = filterCommands(items, 'plo')
        expect(result).toHaveLength(1)
        expect(result[0]?.label).toBe('/deploy')
    })

    it('无匹配返回空', () => {
        const result = filterCommands(items, 'xyz')
        expect(result).toHaveLength(0)
    })

    it('空列表始终返回空', () => {
        expect(filterCommands([], 'help')).toHaveLength(0)
        expect(filterCommands([], '')).toHaveLength(0)
    })
})
