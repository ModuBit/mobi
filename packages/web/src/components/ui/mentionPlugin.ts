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
import { buildActionUri, MENTION_PATH_CHARS } from '@mobi/shared'
import { resolveFileType } from '@/core/lib/fileTypeMeta'

/** @ 路径字符集协议单源在 shared（MENTION_PATH_CHARS，排除法，见其文档） */
const PATH_CHARS = MENTION_PATH_CHARS

/** start() 热路径用：找下一个「@ 后跟路径字符」处——mid-word 的也算，独立/mid-word 分档在 tokenizer 做 */
const ANY_AT_RE = new RegExp(`@(${PATH_CHARS})`, 'u')

/**
 * 匹配 mention token：@ 前一字符（段首缺省，捕获组可空）+ @ + 路径串。
 * 前字符整体进 raw——它是独立词/mid-word 分档的依据，渲染时原样还回。
 */
const MENTION_TOKEN_RE = new RegExp(`^(.)?@(${PATH_CHARS}+)`, 'u')

/** HTML entity 转义，防止 XSS */
function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
}

/**
 * 将用户消息中的 @<path> mention 渲染为文件引用，形态与 assistant 消息里的
 * mobi:// 文件链接完全一致（FileTypeBadge + 链接样式由 ActionLink 统一叠加）：
 * - 文件 = `<a href="mobi://file/open?...">`，ExternalLink 拦截为 ActionLink，
 *   点击在 inspector pane 打开；刻意不挂 mention-badge 旧 pill 样式——那是
 *   「双层色块」的来源（2026-09-26 真机），badge 统一由 FileTypeBadge 承担
 * - 目录 = `<span class="mention-directory">`（folder glyph + mono 文本），纯展示
 * path 解析基准 = 会话 cwd，实际可达范围由服务端读边界裁决。
 *
 * inline 级扩展，优先级高于 marked 内置的 GFM 删除线（`~text~`）——否则用户输入
 * `@~/a/b/c` 里的 `~` 会被删除线语法吞掉。mention 把整个引用作为独立 token 先消费。
 *
 * 独立词/mid-word 两档识别门槛（与 composer 触发语义对齐）：
 * - 独立词（@ 前是空白/文本开头）：接受强路径（含 `/` 或 `~`）与带 `.` 的裸文件名
 *   （`@solar-system.html`）；拒纯单词（`@john` 是社交提及，非路径）
 * - mid-word（@ 前贴字符，如 `看@src/a.ts`）：只信强路径——裸名/域名形态贴着字符
 *   九成是 email（`a@b.com`），这是 email 防线
 * 机制上 marked 的 tokenizer 只能拿到游标起的文本，前字符靠 start() 把停点指到
 * @ 前一字符送进 token 串；mid-word 拒绝时用消费式 text token 整体吃掉——否则
 * text 吃掉前缀后游标落在 @ 上二次触发，裸名会被当段首独立词误识别（email 防线洞）。
 */

/** lucide Folder glyph 内联 SVG（目录 mention 用）：与 FileTypeBadge 同源路径数据，
 *  琥珀同色系；DOMPurify 默认放行 svg profile，经清洗后保留 */
const FOLDER_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#E8A33D" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:3px"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>'
function mention(): TokenizerAndRendererExtension {
    return {
        name: 'mention',
        level: 'inline',
        start(src: string) {
            // 停点指到 @ 前一字符（段首停 @ 本身），让 tokenizer 能看到前字符做分档
            const idx = src.search(ANY_AT_RE)
            return idx === -1 ? undefined : idx > 0 ? idx - 1 : 0
        },
        tokenizer(src: string) {
            const match = src.match(MENTION_TOKEN_RE)
            if (!match) return undefined
            const lead = match[1] ?? ''
            const path = match[2]
            const standalone = lead === '' || /[ \t\n]/.test(lead)
            const strongPath = path.includes('/') || path.startsWith('~')
            if (!(standalone ? strongPath || path.includes('.') : strongPath)) {
                // 消费式拒绝：整串作为纯文本 token 吃掉（marked 内置 text renderer 按
                // token.text 输出），游标越过 @ 不再二次触发
                return { type: 'text', raw: match[0], text: match[0] }
            }

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const token: any = {
                type: 'mention',
                raw: match[0],
                // 含引导字符的完整文本，供 renderer 还回（保留用户原文）
                mention: match[0],
                path,
            }
            return token
        },
        renderer(token) {
            const text = token as unknown as { type: string; raw: string }
            // 消费式拒绝的纯文本 token：走不到本扩展 renderer（marked 按类型分发到内置
            // text renderer），此分支仅防御性兜底
            if (text.type !== 'mention') return escapeHtml(text.raw)
            const { mention, path } = token as unknown as { mention: string; path: string }

            // raw 里的引导字符（空白或 mid-word 前字符）原样还回，否则与前文之间的空格被吞
            const lead = mention.slice(0, mention.length - path.length - 1)
            const label = `@${path}`
            // 目录（resolveFileType 判定单源，无 `.` basename / 尾 `/`）：纯展示不可点
            if (resolveFileType(path)?.kind === 'directory') {
                return `${escapeHtml(lead)}<span class="mention-directory">${FOLDER_SVG}${escapeHtml(label)}</span>`
            }
            // 点击 = mobi://file/open（ADR 0003）：渲染时构造 URI 走统一执行链（消息即快照，
            // 落库不动）。裸 <a> 由 ExternalLink 拦截为 ActionLink——类型徽章/链接样式/点击
            // 分发全部复用 assistant 文件链接的渲染链；name 缺省由执行器基名兜底
            const uri = buildActionUri('file/open', { path })
            return `${escapeHtml(lead)}<a href="${escapeHtml(uri)}">${escapeHtml(label)}</a>`
        },
    }
}

export default mention
