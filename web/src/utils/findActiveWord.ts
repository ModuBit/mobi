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
 * 查找输入文本中光标所在位置的活跃单词
 * @param text 完整文本
 * @param cursorPosition 光标位置
 * @returns 活跃单词信息，包含单词文本、起始位置和结束位置
 */
export interface ActiveWord {
    /** 活跃单词文本 */
    word: string
    /** 单词在文本中的起始位置 */
    start: number
    /** 单词在文本中的结束位置（不包含） */
    end: number
}

/**
 * 从文本中提取光标所在位置的单词
 * 支持路径（包含 / 和 \）和普通单词
 */
export function findActiveWord(text: string, cursorPosition: number): ActiveWord | null {
    if (!text || cursorPosition < 0 || cursorPosition > text.length) {
        return null
    }

    // 向左查找单词边界
    let start = cursorPosition
    while (start > 0) {
        const char = text[start - 1]
        // 路径字符：字母、数字、下划线、连字符、点、斜杠、反斜杠、冒号（Windows 盘符）
        if (/[\w\-./\\:]/.test(char)) {
            start--
        } else {
            break
        }
    }

    // 向右查找单词边界
    let end = cursorPosition
    while (end < text.length) {
        const char = text[end]
        if (/[\w\-./\\:]/.test(char)) {
            end++
        } else {
            break
        }
    }

    // 如果没有找到有效单词，返回 null
    if (start === end) {
        return null
    }

    const word = text.slice(start, end)

    return {
        word,
        start,
        end,
    }
}
