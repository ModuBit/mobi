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

import { findStandaloneTriggerBeforeCursor } from './triggerDetector'

/** 拼接 @ 引用路径（保留用户输入的相对形式） */
export function buildMentionPath(mentionInput: string, selectedName: string): string {
    const lastSlash = mentionInput.lastIndexOf('/')
    const dirPart = lastSlash !== -1 ? mentionInput.slice(0, lastSlash + 1) : ''
    return dirPart + selectedName
}

/** @ 引用路径的合法字符（含路径分隔符 / . ~ 等） */
const MENTION_PATH_CHARS = /^[a-zA-Z0-9./_\-~]*$/

/**
 * 在完整文本中找到包含光标位置的 @mention 模式
 * 从光标位置向前查找最近的 @，验证其是否为独立词、其后到光标的内容是否为合法路径
 */
export function detectMentionAtCursor(
    fullText: string,
    cursorPos: number,
): { atIndex: number; afterAt: string } | null {
    const found = findStandaloneTriggerBeforeCursor(
        fullText,
        cursorPos,
        '@',
        after => MENTION_PATH_CHARS.test(after),
    )
    return found ? { atIndex: found.index, afterAt: found.after } : null
}
