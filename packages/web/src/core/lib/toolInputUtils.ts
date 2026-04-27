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

import { isObject } from '@mobi/shared'

/**
 * 获取输入对象中指定键的字符串值
 */
export function getInputString(input: unknown, key: string): string | null {
    if (!isObject(input)) return null
    const value = input[key]
    return typeof value === 'string' ? value : null
}

/**
 * 获取输入对象中任意一个键的字符串值
 */
export function getInputStringAny(input: unknown, keys: string[]): string | null {
    for (const key of keys) {
        const value = getInputString(input, key)
        if (value) return value
    }
    return null
}

/**
 * 截断文本
 */
export function truncate(text: string, maxLen: number): string {
    if (text.length <= maxLen) return text
    return text.slice(0, maxLen - 3) + '...'
}

/**
 * 生成权限请求的友好描述
 * 返回格式如: "Edit: src/file.ts" 或 "Bash: npm install" 或 "Read: README.md"
 */
export function getPermissionDescription(toolName: string, input: unknown): string | null {
    if (!isObject(input)) return null

    // 提取常见字段
    const filePath = getInputString(input, 'file_path') || getInputString(input, 'filePath')
    const command = getInputString(input, 'command') || getInputString(input, 'cmd')
    const url = getInputString(input, 'url')

    switch (toolName) {
        case 'Edit':
        case 'MultiEdit':
            return filePath ? `Edit: ${filePath}` : null
        case 'Write':
            return filePath ? `Write: ${filePath}` : null
        case 'Read':
            return filePath ? `Read: ${filePath}` : null
        case 'NotebookEdit':
            return filePath ? `Notebook: ${filePath}` : null
        case 'Bash':
            return command ? `Bash: ${truncate(command, 50)}` : null
        case 'Task': {
            const desc = getInputString(input, 'description') || getInputString(input, 'prompt')
            return desc ? `Task: ${truncate(desc, 40)}` : null
        }
        case 'WebFetch':
        case 'WebSearch':
            return (url || getInputString(input, 'query')) ? `${toolName}: ${truncate(url || getInputString(input, 'query')!, 40)}` : null
        default:
            if (filePath) return `${toolName}: ${filePath}`
            if (command) return `${toolName}: ${truncate(command, 40)}`
            if (url) return `${toolName}: ${truncate(url, 40)}`
            return null
    }
}
