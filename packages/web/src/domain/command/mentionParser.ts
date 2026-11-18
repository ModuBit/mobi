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
import { MENTION_PATH_CHARS as MENTION_PATH_CHARS_SRC } from '@mobi/shared'

/** 拼接 @ 引用路径（保留用户输入的相对形式） */
export function buildMentionPath(mentionInput: string, selectedName: string): string {
    const lastSlash = mentionInput.lastIndexOf('/')
    const dirPart = lastSlash !== -1 ? mentionInput.slice(0, lastSlash + 1) : ''
    return dirPart + selectedName
}

/**
 * @ 引用路径字符集协议单源在 shared（MENTION_PATH_CHARS，排除法），本处组装成
 * 「整串合法」锚定正则供光标检测使用，与渲染端 mentionPlugin 消费同一字符集
 */
const MENTION_PATH_CHARS = new RegExp(`^${MENTION_PATH_CHARS_SRC}*$`, 'u')
const PATH_PREFIX = new RegExp(`^${MENTION_PATH_CHARS_SRC}+`, 'u')
const MENTION_PREFIX = new RegExp(`^(.)?@(${MENTION_PATH_CHARS_SRC}+)`, 'u')
const MENTION_START = new RegExp(`@${MENTION_PATH_CHARS_SRC}`, 'u')

export function mentionPathPrefix(text: string): string {
    return PATH_PREFIX.exec(text)?.[0] ?? ''
}

export function isMentionPath(path: string): boolean {
    return path !== '' && MENTION_PATH_CHARS.test(path)
}

export function findMentionStart(text: string): number {
    return text.search(MENTION_START)
}

export function matchMentionPrefix(text: string) {
    const match = MENTION_PREFIX.exec(text)
    if (!match) return undefined
    const [, lead = '', path] = match
    return { lead, path }
}

/** 独立词可接受带点的裸文件名；贴着文字时要求强路径，避免误认邮箱。 */
export function classifyMention(lead: string, path: string): 'mention' | 'plain' | 'punctuation' {
    const standalone = lead === '' || /[ \t\n]/.test(lead)
    if (!standalone && /[^\p{L}\p{N}\s]/u.test(lead)) return 'punctuation'
    const strongPath = path.includes('/') || path.startsWith('~')
    return strongPath || (standalone && path.includes('.')) ? 'mention' : 'plain'
}

/** 已由编辑器划分出正文的文本段：只找范围，不重做 Markdown 分词。 */
export function scanMentions(text: string) {
    const mentions: { from: number; to: number; path: string }[] = []
    for (let at = text.indexOf('@'); at !== -1; at = text.indexOf('@', at + 1)) {
        const lead = [...text.slice(Math.max(0, at - 2), at)].at(-1) ?? ''
        const match = matchMentionPrefix(lead + text.slice(at))
        if (!match) continue
        // 正文分段已消费 Markdown 定界符；剩余的标点是 @ 的自然左边界。
        const kind = classifyMention(match.lead, match.path)
        const to = at + 1 + match.path.length
        if (kind === 'mention' || (kind === 'punctuation' && classifyMention('', match.path) === 'mention')) {
            mentions.push({ from: at, to, path: match.path })
        }
        at = to - 1
    }
    return mentions
}

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
