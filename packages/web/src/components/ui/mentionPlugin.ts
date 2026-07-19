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

import type { TokenizerAndRendererExtension } from 'marked'

/** @ 路径合法字符（与 mentionParser 的 MENTION_PATH_CHARS 一致） */
const PATH_CHARS = '[a-zA-Z0-9./_\\-~]'

/** 匹配 mention token：@ 后跟至少一个路径字符 */
const MENTION_RE = new RegExp(`^@(${PATH_CHARS}+)`)

/** HTML entity 转义，防止 XSS */
function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
}

/**
 * 判定 @ 后的路径是否为 mention（而非 email 等误匹配）。
 *
 * 必须含路径分隔符 `/` 或以 home 前缀 `~` 开头——这样能排除 email（`a@b.com` 的 `@b.com`
 * 既无 `/` 也不以 `~` 开头）。纯文件名引用（`@file`）暂不识别为 mention。
 */
function isMentionPath(path: string): boolean {
    return path.includes('/') || path.startsWith('~')
}

/**
 * 将用户消息中的 @<path> mention 渲染为 Badge。
 *
 * inline 级扩展，优先级高于 marked 内置的 GFM 删除线（`~text~`）——否则用户输入
 * `@~/a/b/c` 里的 `~` 会被删除线语法吞掉，把两个 mention 之间的内容渲染为删除线。
 * mention 把整个 `@~/a/b/c` 作为独立 token 先消费，`~` 不再暴露给删除线。
 *
 * 仅匹配独立词（@ 前为空白或文本开头），避免误伤 email。
 */
function mention(): TokenizerAndRendererExtension {
    return {
        name: 'mention',
        level: 'inline',
        start(src: string) {
            // 找下一个「@ 后跟路径字符」的位置，提示 marked 在此停止 text 消费、尝试本扩展
            const idx = src.search(/@[a-zA-Z0-9./_\-~]/)
            return idx === -1 ? undefined : idx
        },
        tokenizer(src: string) {
            const match = src.match(MENTION_RE)
            if (!match) return undefined
            const path = match[1]
            if (!isMentionPath(path)) return undefined

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const token: any = {
                type: 'mention',
                raw: match[0],
                // 含 @ 的完整文本，供 renderer 渲染（保留用户输入的 @ 前缀）
                mention: match[0],
                path,
            }
            return token
        },
        renderer(token) {
            const { mention } = token as unknown as { mention: string }
            return `<span class="mention-badge">${escapeHtml(mention)}</span>`
        },
    }
}

export default mention
