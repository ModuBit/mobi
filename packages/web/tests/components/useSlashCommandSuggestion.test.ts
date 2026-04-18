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
    isSlashTrigger,
    mergeCommandsAndSkills,
    filterCommands,
} from './useSlashCommandSuggestion.test-helper'
import type { SlashCommand, Skill } from './useSlashCommandSuggestion.test-helper'

// ========== isSlashTrigger ==========

describe('isSlashTrigger', () => {
    it('单独 / 触发', () => {
        expect(isSlashTrigger('/')).toBe(true)
    })

    it('/ 后跟文字触发', () => {
        expect(isSlashTrigger('/help')).toBe(true)
    })

    it('/ 后跟空白不触发', () => {
        expect(isSlashTrigger('/ ')).toBe(false)
        expect(isSlashTrigger('/\t')).toBe(false)
        expect(isSlashTrigger('/\n')).toBe(false)
        expect(isSlashTrigger('/ hello')).toBe(false)
    })

    it('空字符串不触发', () => {
        expect(isSlashTrigger('')).toBe(false)
    })

    it('非 / 开头不触发', () => {
        expect(isSlashTrigger('help')).toBe(false)
        expect(isSlashTrigger(' /help')).toBe(false)
    })
})

// ========== mergeCommandsAndSkills ==========

describe('mergeCommandsAndSkills', () => {
    it('空列表返回空数组', () => {
        expect(mergeCommandsAndSkills([], [])).toEqual([])
    })

    it('仅有 commands', () => {
        const commands: SlashCommand[] = [
            { name: 'help', description: '帮助', source: 'builtin' },
        ]
        const result = mergeCommandsAndSkills(commands, [])
        expect(result).toHaveLength(1)
        expect(result[0]).toEqual({
            label: '/help',
            value: '/help',
            description: '帮助',
            source: 'builtin',
        })
    })

    it('仅有 skills', () => {
        const skills: Skill[] = [
            { name: 'test', description: '测试', source: 'user' },
        ]
        const result = mergeCommandsAndSkills([], skills)
        expect(result).toHaveLength(1)
        expect(result[0]).toEqual({
            label: '/test',
            value: '/test',
            description: '测试',
            source: 'user',
        })
    })

    it('合并 commands 和 skills', () => {
        const commands: SlashCommand[] = [
            { name: 'help', description: '帮助', source: 'builtin' },
        ]
        const skills: Skill[] = [
            { name: 'test', description: '测试', source: 'user' },
        ]
        const result = mergeCommandsAndSkills(commands, skills)
        expect(result).toHaveLength(2)
    })

    it('同名时保留 command，丢弃 skill', () => {
        const commands: SlashCommand[] = [
            { name: 'help', description: '命令帮助', source: 'builtin' },
        ]
        const skills: Skill[] = [
            { name: 'help', description: '技能帮助', source: 'user' },
        ]
        const result = mergeCommandsAndSkills(commands, skills)
        expect(result).toHaveLength(1)
        expect(result[0]?.description).toBe('命令帮助')
        expect(result[0]?.source).toBe('builtin')
    })

    it('同名不区分大小写（去重 key 统一小写）', () => {
        const commands: SlashCommand[] = [
            { name: 'Help', description: '命令', source: 'builtin' },
        ]
        const skills: Skill[] = [
            { name: 'help', description: '技能', source: 'user' },
        ]
        const result = mergeCommandsAndSkills(commands, skills)
        expect(result).toHaveLength(1)
    })

    it('name 已有 / 前缀不重复添加', () => {
        const commands: SlashCommand[] = [
            { name: '/help', description: '帮助', source: 'builtin' },
        ]
        const result = mergeCommandsAndSkills(commands, [])
        expect(result[0]?.label).toBe('/help')
        expect(result[0]?.value).toBe('/help')
    })

    it('多个 commands 去重', () => {
        const commands: SlashCommand[] = [
            { name: 'help', description: '帮助1', source: 'builtin' },
            { name: 'help', description: '帮助2', source: 'user' },
        ]
        const result = mergeCommandsAndSkills(commands, [])
        expect(result).toHaveLength(1)
        expect(result[0]?.description).toBe('帮助1')
    })
})

// ========== filterCommands ==========

describe('filterCommands', () => {
    const items = [
        { label: '/help', value: '/help', description: '帮助', source: 'builtin' as const },
        { label: '/test', value: '/test', description: '测试', source: 'user' as const },
        { label: '/deploy', value: '/deploy', description: '部署', source: 'plugin' as const },
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
