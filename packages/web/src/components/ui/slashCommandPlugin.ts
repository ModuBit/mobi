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

/** 匹配 /command（字母开头，允许连字符和下划线），后跟可选描述文本 */
const SLASH_COMMAND_RULE = /^\/([a-zA-Z][\w-]*)(.*)/

/** HTML entity 转义，防止 XSS */
function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
}

/**
 * 将用户消息开头的 /command 渲染为 Badge 标签样式。
 * 仅在段落起始位置匹配（block level），不影响消息中间出现的 /xxx。
 * rest 部分通过 marked inline lexer 解析，支持 markdown 格式。
 */
function slashCommand(): TokenizerAndRendererExtension {
    return {
        name: 'slashCommand',
        level: 'block',
        start(src: string) {
            return src[0] === '/' ? 0 : undefined
        },
        tokenizer(src: string) {
            const match = src.match(SLASH_COMMAND_RULE)
            if (!match) return undefined

            const command = match[1]
            const rest = match[2].trimStart()

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const token: any = {
                type: 'slashCommand',
                raw: match[0],
                command,
                tokens: [] as Token[],
            }

            // 将 rest 解析为 inline tokens，支持 markdown 格式
            this.lexer.inline(rest, token.tokens)

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
            return restHtml ? `<p>${badge} ${restHtml}</p>` : `<p>${badge}</p>`
        },
    }
}

export default slashCommand
