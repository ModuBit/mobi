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
import { buildActionUri } from '@mobi/shared'
import { resolveFileType } from '@/core/lib/fileTypeMeta'
import { findMentionStart, matchMentionPrefix } from '@/domain/command/mentionParser'

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

/** lucide Folder glyph 不再内联 SVG：raw HTML 形态的 svg 会被 sanitize 剥 <path d>
 *  致空白（slash-command 同坑），目录 mention 输出自定义标签、由 Markdown 组件映射
 *  表渲染真 lucide Folder（DIRECTORY_TINT 同源 FileTypeBadge） */

function mention(): TokenizerAndRendererExtension {
    return {
        name: 'mention',
        level: 'inline',
        start(src: string) {
            // 停点指到 @ 前一字符（段首停 @ 本身），让 tokenizer 能看到前字符做分档
            const idx = findMentionStart(src)
            return idx === -1 ? undefined : Math.max(0, idx - 1)
        },
        tokenizer(src: string) {
            const match = matchMentionPrefix(src)
            if (!match) return undefined
            const { raw, lead, path, plain } = match
            if (plain) return { type: 'text', raw, text: raw }
            return { type: 'mention', raw, lead, path }
        },
        renderer(token) {
            // 引导字符（空白或 mid-word 前字符）原样还回，不计入徽章。
            const { lead, path } = token as unknown as { lead: string; path: string }
            const label = `@${path}`
            // 目录（resolveFileType 判定单源，无 `.` basename / 尾 `/`）：纯展示不可点，
            // glyph 走 <mention-directory> 标签由 Markdown 组件层渲染（见上注）
            if (resolveFileType(path)?.kind === 'directory') {
                return `${escapeHtml(lead)}<mention-directory data-label="${escapeHtml(label)}"></mention-directory>`
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
