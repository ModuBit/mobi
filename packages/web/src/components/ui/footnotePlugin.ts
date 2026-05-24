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

import type { Tokens, TokenizerAndRendererExtension } from 'marked'

/** 脚注定义数据 */
export interface FootnoteItem {
    key: string
    num: number
    title: string
    url?: string
    description?: string
}

/** 匹配脚注定义行：[^n]: content */
const FN_DEF_RE = /^\[\^(\d+)\]:\s+(.+)$/

/** 匹配 markdown 链接 [text](url) */
const LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/g

/**
 * 从 markdown 内容中提取脚注定义并返回清洗后的内容。
 *
 * 逐行解析，跳过代码围栏（``` / ~~~）内部，仅提取完整的定义行。
 * 流式场景下不完整的定义（缺少正文）会被忽略，避免闪烁。
 */
export function extractFootnotes(content: string): {
    cleanContent: string
    footnotes: FootnoteItem[]
} {
    // 快速路径：不含脚注语法则直接返回
    if (!content.includes('[^') || !content.includes(']:')) {
        return { cleanContent: content, footnotes: [] }
    }

    const footnotes: FootnoteItem[] = []
    const lines = content.split('\n')
    const keptLines: string[] = []

    let inCodeFence = false
    let fenceMarker = ''

    for (const line of lines) {
        // 检测代码围栏开合
        if (!inCodeFence) {
            const fenceMatch = line.match(/^(`{3,}|~{3,})/)
            if (fenceMatch) {
                inCodeFence = true
                fenceMarker = fenceMatch[1][0] // ` 或 ~
                keptLines.push(line)
                continue
            }
        } else {
            // 同类型围栏闭合（允许缩进）
            const closeMatch = line.match(new RegExp(`^\\s*${fenceMarker}{3,}\\s*$`))
            if (closeMatch) {
                inCodeFence = false
                fenceMarker = ''
            }
            keptLines.push(line)
            continue
        }

        // 非代码块内：尝试匹配脚注定义
        const defMatch = line.match(FN_DEF_RE)
        if (defMatch) {
            const num = parseInt(defMatch[1], 10)
            const rawBody = defMatch[2].trim()
            // 流式场景：正文可能尚未到达，跳过空定义
            if (!rawBody) {
                keptLines.push(line)
                continue
            }

            // 提取链接
            LINK_RE.lastIndex = 0
            const linkMatch = LINK_RE.exec(rawBody)

            // 移除所有链接，剩余作为 description
            const description = linkMatch
                ? rawBody.replace(LINK_RE, '').trim() || undefined
                : undefined

            footnotes.push({
                key: `fn-${num}`,
                num,
                title: linkMatch ? linkMatch[1] : rawBody,
                url: linkMatch ? linkMatch[2] : undefined,
                description,
            })
            // 定义行不保留到清洗内容
        } else {
            keptLines.push(line)
        }
    }

    if (footnotes.length === 0) {
        return { cleanContent: content, footnotes: [] }
    }

    const cleanContent = keptLines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()
    return { cleanContent, footnotes }
}

/**
 * marked 内联扩展：将 `[^n]` 渲染为自定义 `<footnote-ref>` 标签，
 * 由 XMarkdown 的 components 映射为 React 组件（tag 样式 + Popover）。
 *
 * 不依赖外部数据，脚注内容通过 React Context 在组件层面注入。
 */
export function footnoteRefExtension(): TokenizerAndRendererExtension {
    return {
        name: 'footnoteRef',
        level: 'inline',
        start(src: string) {
            return src.indexOf('[^')
        },
        tokenizer(src: string) {
            const match = src.match(/^\[\^(\d+)\]/)
            if (!match) return undefined

            return {
                type: 'footnoteRef',
                raw: match[0],
                num: match[1],
                renderType: 'component' as const,
            }
        },
        renderer(token: Tokens.Generic) {
            const num = (token as unknown as { num: string }).num ?? '0'
            return `<footnote-ref data-num="${num}">${num}</footnote-ref>`
        },
    }
}
