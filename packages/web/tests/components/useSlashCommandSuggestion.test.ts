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
        expect(detectSlashAtCursor('/', 1)).toBe('')
    })

    it('/help，光标在末尾 → 触发，filter 为 help', () => {
        expect(detectSlashAtCursor('/help', 5)).toBe('help')
    })

    it('/help，光标在 / 后 → 触发，filter 为空', () => {
        expect(detectSlashAtCursor('/help', 1)).toBe('')
    })

    it('/help，光标在 h 后 → 触发，filter 为 h', () => {
        expect(detectSlashAtCursor('/help', 2)).toBe('h')
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
        expect(detectSlashAtCursor('/super abc', 6)).toBe('super')
    })

    it('空字符串不触发', () => {
        expect(detectSlashAtCursor('', 0)).toBeNull()
    })

    it('非 / 开头不触发', () => {
        expect(detectSlashAtCursor('help', 4)).toBeNull()
        expect(detectSlashAtCursor(' /help', 6)).toBeNull()
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
