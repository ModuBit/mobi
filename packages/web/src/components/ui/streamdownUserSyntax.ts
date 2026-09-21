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
 * 用户消息专属语法 → Streamdown 自定义标签预处理（ticket 04）
 *
 * 用户消息的 `/命令` badge 与 `@路径` mention badge（TextBlock 的
 * enableSlashCommand/enableMention 路径）。识别逻辑移植自旧栈 marked 扩展
 * （slashCommandPlugin/mentionPlugin，正则与判定函数保持一致，契约测试平移），
 * 输出形态改为 Streamdown 原生支持的 raw HTML 自定义标签：
 * `<slash-command>/cmd</slash-command>`、`<mention uri="...">@path</mention>`，
 * 经 allowedTags 放行 + literalTagContent（子内容不再二次 parse，保护路径中的
 * `~`/`_` 不被删除线/强调吞掉）+ components 渲染为 badge。
 *
 * 为什么是预处理而非 remark 文本节点切分（ticket 定稿时的假设）：删除线是
 * remark-gfm 的 micromark 解析期行为，任何解析后的文本节点切分都晚于它——
 * `@~/a @~/e` 的两个 `~` 会先被消费成 delete 节点，切分插件拿不到原文。
 * 预处理在 parse 之前把 mention 整体包进 literal 标签，删除线无从触发。
 */

import { buildActionUri, MENTION_PATH_CHARS } from '@mobi/shared'

/** @ 路径字符集协议单源在 shared（MENTION_PATH_CHARS，排除法） */
const PATH_CHARS = MENTION_PATH_CHARS

/** 匹配 mention token：@ 后跟至少一个路径字符（与旧栈 MENTION_RE 一致） */
const MENTION_RE = new RegExp(`@(${PATH_CHARS}+)`, 'gu')

/**
 * 匹配 /command：独立词 / 开头，命令名 [a-zA-Z0-9_-]+，命令名后必须是空白/换行/结尾
 * （避免 /path/to/x、/foo(bar) 误判）——与旧栈 SLASH_COMMAND_RULE 的触发判定一致；
 * 参数部分不再吞入 token（留在原文由 markdown 正常解析，等价旧栈的 inline 重解析）
 */
const SLASH_COMMAND_RE = /(^|\s)\/([a-zA-Z0-9_-]+)(?=[ \t\n]|$)/g

/** 判定 @ 后路径是否为 mention（排除 email 与普通 @ 提及）——与旧栈一致 */
function isMentionPath(path: string): boolean {
    return path.includes('/') || path.startsWith('~')
}

/** HTML 属性转义（防止 uri/text 中的引号破坏标签结构） */
function escapeAttr(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
}

/** code 区段掩码哨兵（私用区字符 U+E000/U+E001，不出现在正文中，不触发 no-control-regex） */
const MASK_OPEN = '\uE000'
const MASK_CLOSE = '\uE001'

export interface UserSyntaxOptions {
    /** 渲染 `/命令` badge（TextBlock 用户消息路径启用） */
    enableSlashCommand?: boolean
    /** 渲染 `@路径` mention badge（TextBlock 用户消息路径启用） */
    enableMention?: boolean
}

/**
 * 把用户消息中的 /命令 与 @路径 预处理为 Streamdown 自定义标签。
 * code 区段（fenced/行内）掩码保护，不参与识别。
 */
export function preprocessUserSyntax(content: string, options: UserSyntaxOptions): string {
    const { enableSlashCommand = false, enableMention = false } = options
    if (!enableSlashCommand && !enableMention) return content

    // code 区段掩码保护（占位符为私用区字符，不出现在正文中）
    const segments: string[] = []
    const mask = (m: string) => `${MASK_OPEN}${segments.push(m) - 1}${MASK_CLOSE}`
    const masked = content
        .replace(/```[\s\S]*?```/g, mask)
        .replace(/~~~[\s\S]*?~~~/g, mask)
        .replace(/`[^`\n]*`/g, mask)

    let converted = masked
    if (enableSlashCommand) {
        converted = converted.replace(SLASH_COMMAND_RE, (_m, lead: string, cmd: string) =>
            `${lead}<slash-command>/${escapeAttr(cmd)}</slash-command>`)
    }
    if (enableMention) {
        converted = converted.replace(MENTION_RE, (mention: string, path: string) => {
            if (!isMentionPath(path)) return mention
            const uri = buildActionUri('file/open', { path })
            return `<mention uri="${escapeAttr(uri)}">${escapeAttr(mention)}</mention>`
        })
    }

    return converted.replace(new RegExp(`${MASK_OPEN}(\\d+)${MASK_CLOSE}`, 'g'), (_m, i: string) => segments[Number(i)])
}

/** Streamdown allowedTags：放行两个自定义标签及其属性 */
export const USER_SYNTAX_ALLOWED_TAGS: Record<string, string[]> = {
    mention: ['uri'],
    'slash-command': [],
}

/** literalTagContent：子内容视为纯文本，不再二次 parse（保护路径中的 `~`/`_`） */
export const USER_SYNTAX_LITERAL_TAGS: string[] = ['mention', 'slash-command']
