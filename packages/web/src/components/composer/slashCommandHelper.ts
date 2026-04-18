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

import type { SlashCommand } from '@/api/types'
import type { Skill } from '@/hooks/queries/useSkills'

/**
 * 斜杠命令建议项
 */
export interface SlashCommandSuggestionItem {
    /** 显示标签 */
    label: string
    /** 实际值（含 / 前缀） */
    value: string
    /** 描述信息 */
    description?: string
    /** 来源 */
    source?: 'builtin' | 'user' | 'plugin' | 'project'
}

/**
 * 判断输入文本是否触发斜杠命令下拉
 * 规则：第一个字符是 /，且 / 后面不含空白字符
 */
export function isSlashTrigger(text: string): boolean {
    return text[0] === '/' && (text.length === 1 || !/\s/.test(text.slice(1)))
}

/**
 * 合并 SlashCommand 和 Skill 列表并去重
 * 同名时保留 SlashCommand，每项 label/value 加 / 前缀
 */
export function mergeCommandsAndSkills(
    commands: SlashCommand[],
    skills: Skill[],
): SlashCommandSuggestionItem[] {
    const seen = new Set<string>()
    const result: SlashCommandSuggestionItem[] = []

    // 先处理 commands（优先级高）
    for (const cmd of commands) {
        const name = cmd.name.startsWith('/') ? cmd.name : `/${cmd.name}`
        const key = name.toLowerCase()
        if (!seen.has(key)) {
            seen.add(key)
            result.push({
                label: name,
                value: name,
                description: cmd.description,
                source: cmd.source,
            })
        }
    }

    // 再处理 skills（跳过与 command 同名的）
    for (const skill of skills) {
        const name = skill.name.startsWith('/') ? skill.name : `/${skill.name}`
        const key = name.toLowerCase()
        if (!seen.has(key)) {
            seen.add(key)
            result.push({
                label: name,
                value: name,
                description: skill.description,
                source: skill.source,
            })
        }
    }

    return result
}

/**
 * 过滤命令列表（不区分大小写的 contains 匹配）
 */
export function filterCommands(
    items: SlashCommandSuggestionItem[],
    filter: string,
): SlashCommandSuggestionItem[] {
    if (!filter) return items
    const lower = filter.toLowerCase()
    return items.filter(
        (item) =>
            item.label.toLowerCase().includes(lower) ||
            item.value.toLowerCase().includes(lower),
    )
}
