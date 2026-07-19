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

import type { Token, Tokens, TokenizerAndRendererExtension } from 'marked'

/**
 * 匹配 /command：独立词 / 开头，命令名 [a-zA-Z0-9_-]+，
 * 命令名后必须是空白/换行/结尾（lookahead）——避免 /path/to/x、/foo(bar) 误判。
 * 第二组捕获命令名后的参数（到行尾），参数走 inline 解析支持 markdown。
 *
 * 触发条件与 sender 的 detectSlashAtCursor 对齐：独立词（/ 前为行首或空白），
 * 不再要求整段以 / 开头。
 */
const SLASH_COMMAND_RULE = /^\/([a-zA-Z0-9_-]+)(?=[ \t\n]|$)(?:[ \t]([^\n]*))?/

/** HTML entity 转义，防止 XSS */
function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
}

/**
 * 将用户消息中的 /command 渲染为 Badge 标签样式。
 *
 * inline 级扩展，匹配任意位置的独立词 /command（与 sender 触发条件对齐，不再限首行首字符）。
 * rest（参数）部分通过 marked inline lexer 解析，支持 markdown 格式。
 */
function slashCommand(): TokenizerAndRendererExtension {
    return {
        name: 'slashCommand',
        level: 'inline',
        start(src: string) {
            // 找下一个「独立词 / 后跟命令名字符」的位置（/ 前为空白或开头）
            const m = src.match(/(?:^|\s)\/[a-zA-Z0-9_-]/)
            if (!m) return undefined
            // 跳过可能的前导空白，返回 / 的位置
            return m.index! + (src[m.index!] === '/' ? 0 : 1)
        },
        tokenizer(src: string) {
            const match = src.match(SLASH_COMMAND_RULE)
            if (!match) return undefined

            const command = match[1]
            const rest = match[2] ?? ''

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const token: any = {
                type: 'slashCommand',
                raw: match[0],
                command,
                tokens: [] as Token[],
            }

            // 将参数解析为 inline tokens，支持 markdown 格式
            if (rest) {
                this.lexer.inline(rest, token.tokens)
            }

            return token
        },
        renderer(token: Tokens.Generic) {
            const { command, tokens } = token as unknown as {
                command: string
                tokens: Token[]
            }
            const badge = `<span class="slash-command-badge">/${escapeHtml(command)}</span>`
            const restHtml = tokens.length > 0
                ? this.parser.parseInline(tokens)
                : ''
            return restHtml ? `${badge} ${restHtml}` : badge
        },
    }
}

export default slashCommand
