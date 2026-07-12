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

import type { Command } from '@/core/data/api/types'
import { getCommandsOrderByScore } from '@/core/lib/commandUsage'
import { findStandaloneTriggerBeforeCursor } from './triggerDetector'

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
    /** 参数提示（如 <message>） */
    argumentHint?: string
}

/** 命令名合法字符（字母、数字、下划线、连字符）；用于过滤路径/括号等误触发 */
const COMMAND_NAME_CHARS = /^[a-zA-Z0-9_-]*$/

/**
 * 检测光标位置是否处于斜杠命令模式
 * 规则与 @mention 对齐：从光标向前找最近的 /，要求其前为行首或空白（独立词），
 * 且 / 到光标之间内容仅含命令名合法字符（光标仍在命令词内）。
 *
 * 这样 / 不必出现在整段文本开头——"foo /he"、" /help"、换行后 "/help" 都能触发；
 * 而 "/path/to/x"、"/foo(bar)" 这类路径/含特殊字符的文本不会误触发。
 *
 * @returns { slashIndex, filter }，filter 不含 / 前缀；或 null 表示不触发
 */
export function detectSlashAtCursor(
    text: string,
    cursorPos: number,
): { slashIndex: number; filter: string } | null {
    const found = findStandaloneTriggerBeforeCursor(
        text,
        cursorPos,
        '/',
        after => COMMAND_NAME_CHARS.test(after),
    )
    return found ? { slashIndex: found.index, filter: found.after } : null
}

function ensureSlashPrefix(name: string): string {
    return name.startsWith('/') ? name : `/${name}`
}

/**
 * 将 Command[] 转换为建议项列表（去重，按使用频率排序）
 * @param workingDir 当前工作目录，用于绑定使用统计
 */
export function toCommandSuggestions(commands: Command[], workingDir?: string): SlashCommandSuggestionItem[] {
    const seen = new Set<string>()
    const result: SlashCommandSuggestionItem[] = []

    for (const cmd of commands) {
        const name = ensureSlashPrefix(cmd.name)
        const key = name.toLowerCase()
        if (!seen.has(key)) {
            seen.add(key)
            result.push({
                label: name,
                value: name,
                description: cmd.description,
                argumentHint: cmd.argumentHint || undefined,
            })
        }
    }

    // 按使用统计排序（高分在前），未使用的保持原序
    if (workingDir && result.length > 1) {
        const ordered = getCommandsOrderByScore(workingDir, result.map(r => r.value))
        const byValue = new Map(result.map(r => [r.value, r]))
        return ordered.map(v => byValue.get(v)!).filter(Boolean)
    }

    return result
}

/**
 * 过滤命令列表（不区分大小写的 contains 匹配）
 * @param filter 不含 / 前缀的过滤文本
 */
export function filterCommands(
    items: SlashCommandSuggestionItem[],
    filter: string,
): SlashCommandSuggestionItem[] {
    if (!filter) return items
    const lower = filter.toLowerCase()
    return items.filter(item => item.label.toLowerCase().includes(lower))
}
