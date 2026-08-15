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
 * @ant-design/x-markdown/plugins/Latex 的补丁版本
 *
 * 修复：inline 规则中 `[^$]` 改为 `[^\n$]`，防止行内 `$...$` 跨行匹配。
 * 例如 `$0.2290\nsome text\n$` 不应被解析为行内 LaTeX。
 *
 * 其余逻辑保持与原插件一致。
 */

import type { Tokens, TokenizerAndRendererExtension } from 'marked'
import type { KatexOptions } from 'katex'

/** katex 模块类型（动态 import 推断） */
type KatexModule = typeof import('katex')

/**
 * 模块级 katex 实例：动态加载完成前为 null。
 *
 * katex（raw ~234K + gzip ~70K）改为按需加载——只有消息内容探测到公式特征
 * （containsLatex）才拉 chunk，不进会话页首载关键路径；同时静态 import 与
 * 异步链混用会让 bundler 把 katex 复制两份（实测 SessionDetailPage 内嵌一份 +
 * 独立 katex chunk 一份），改为纯动态后自然消除。
 */
let katexModule: KatexModule | null = null

/** 加载 promise 缓存：并发/重复调用共享同一次加载 */
let katexLoadPromise: Promise<void> | null = null

/**
 * 按需加载 katex（含样式）。幂等。
 * Markdown 层探测到公式特征时调用，完成后才把 Latex 扩展加入渲染配置。
 */
export function ensureKatexLoaded(): Promise<void> {
    if (!katexLoadPromise) {
        katexLoadPromise = Promise.all([
            import('katex'),
            // 样式随动态 chunk code-split，import 时注入（替代原静态 import）
            import('katex/dist/katex.min.css'),
        ]).then(([mod]) => {
            katexModule = mod
        })
    }
    return katexLoadPromise
}

/**
 * 探测内容是否含 LaTeX 公式（决定是否触发 katex 按需加载）。
 *
 * 超集判定原则：宁可误判（多加载一次 chunk，幂等无害），不可漏判
 * （漏判 = 公式永远显示为原文，属渲染回归）。探测规则对齐 tokenizer 行为：
 * - 行内 `$...$` / 单行 `$$...$$`：不跨行（[^\n$]）
 * - 块级跨行 `$$\n...\n$$`
 * - `\(...\)` 与 `\[...\]`（允许跨行）
 * - fenced code block 与行内 code 内的 `$` 不算——tokenizer 同样不会处理它们
 */
export function containsLatex(content: string): boolean {
    const stripped = content
        .replace(/```[\s\S]*?```/g, '')
        .replace(/~~~[\s\S]*?~~~/g, '')
        .replace(/`[^`\n]*`/g, '')
    return /\$[^\n$]+\$/.test(stripped)
        || /\${1,2}\n[\s\S]*?\n\${1,2}/.test(stripped)
        || /\\\([\s\S]*?\\\)/.test(stripped)
        || /\\\[[\s\S]*?\\\]/.test(stripped)
}

/** HTML 转义：katex 未就绪时退回原文展示用 */
function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
}

/**
 * marked 自定义 token 扩展类型
 *
 * `marked` 的 `Tokens.Generic` 是为扩展 token 留的开放类型，但缺少我们自定义的
 * text/displayMode/isBlock 字段。这里收窄为精确接口，避免 any。
 */
interface KatexToken extends Tokens.Generic {
    text: string
    displayMode?: boolean
    isBlock?: boolean
}

// 原始：[^$]{1,10000}? → 匹配包括换行在内的所有非 $ 字符
// 修复：[^\n$]{1,10000}? → 排除换行，行内 $...$ 不能跨行
export const INLINE_LATEX_RULE =
    /^(?:\${1,2}([^\n$]{1,10000}?)\${1,2}|\\\(([\s\S]{1,10000}?)\\\)|\\\[((?:\\.|[^\\]){1,10000}?)\\\])/

const blockRule =
    /^(\${1,2})\n([\s\S]{1,10000}?)\n\1(?:\s*(?:\n|$))|^\\\[((?:\\.|[^\\]){1,10000}?)\\\]/

function replaceAlign(text: string) {
    return text ? text.replace(/\{align\*\}/g, '{aligned}') : text
}

function createRenderer(options: KatexOptions, newlineAfter: boolean) {
    return (token: Tokens.Generic) => {
        const kt = token as KatexToken
        // Markdown 层保证 Latex 扩展只在 ensureKatexLoaded 完成后进入渲染配置，
        // 正常不会走到此分支；兜底防御：未就绪时退回原文展示而非崩溃
        if (!katexModule) {
            return escapeHtml(kt.text) + (newlineAfter ? '\n' : '')
        }
        return katexModule.default.renderToString(kt.text, {
            ...options,
            displayMode: kt.displayMode,
        }) + (newlineAfter ? '\n' : '')
    }
}

type RenderFn = ReturnType<typeof createRenderer>

function inlineKatex(renderer: RenderFn, replaceAlignStart: boolean): TokenizerAndRendererExtension {
    return {
        name: 'inlineKatex',
        level: 'inline',
        start(src: string) {
            const dollarIndex = src.indexOf('$')
            const parenIndex = src.indexOf('\\(')
            const bracketIndex = src.indexOf('\\[')
            const indices = [dollarIndex, parenIndex, bracketIndex].filter(idx => idx !== -1)
            return indices.length > 0 ? Math.min(...indices) : undefined
        },
        tokenizer(src: string) {
            const match = src.match(INLINE_LATEX_RULE)
            if (!match) return undefined
            const rawText = match[1] || match[2] || match[3] || ''
            const text = replaceAlignStart ? replaceAlign(rawText.trim()) : rawText.trim()

            const isBracketSyntax = match[3] !== undefined
            const hasNewline = rawText.includes('\n')
            return {
                type: 'inlineKatex',
                raw: match[0],
                text,
                displayMode: true,
                isBlock: isBracketSyntax && hasNewline,
            }
        },
        renderer(token: Tokens.Generic) {
            const html = renderer(token)
            if ((token as KatexToken).isBlock) {
                return `<span class="block-katex">${html}</span>`
            }
            return `<span class="inline-katex">${html}</span>`
        },
    }
}

function blockKatex(renderer: RenderFn, replaceAlignStart: boolean): TokenizerAndRendererExtension {
    return {
        name: 'blockKatex',
        level: 'block',
        tokenizer(src: string) {
            const match = src.match(blockRule)
            if (!match) return undefined
            let text = replaceAlign(match[2] || match[3].trim())
            if (replaceAlignStart) {
                text = replaceAlign(text)
            }
            return {
                type: 'blockKatex',
                raw: match[0],
                text,
                displayMode: true,
            }
        },
        renderer,
    }
}

export type LatexOption = {
    katexOptions?: KatexOptions
    replaceAlignStart?: boolean
}

const Latex = (options?: LatexOption): TokenizerAndRendererExtension[] => {
    const {
        replaceAlignStart = true,
        katexOptions: customKatexOptions,
    } = options || {}
    const katexOptions: KatexOptions = {
        output: 'html',
        throwOnError: false,
        ...(customKatexOptions || {}),
    }
    const inlineRenderer = createRenderer(katexOptions, true)
    const blockRenderer = createRenderer(katexOptions, true)
    return [inlineKatex(inlineRenderer, replaceAlignStart), blockKatex(blockRenderer, replaceAlignStart)]
}

export default Latex
