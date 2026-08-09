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

import type { HighlighterCore } from 'shiki/core'
import type { ShikiTransformer } from 'shiki'
import { useEffect, useState } from 'react'

// 单主题：github-light / github-dark（按 isDark 切，切主题重新高亮——静态文件可接受）
export const SHIKI_THEME_LIGHT = 'github-light'
export const SHIKI_THEME_DARK = 'github-dark'

/** 行号 transformer：在每个 <span class="line"> 首位插入 <span class="ln">N</span>。
 *  用真实元素而非 ::before —— 水平滚动锁定行号（sticky）需真实元素，伪元素的 sticky
 *  在水平方向浏览器支持差。CSS .ln sticky left:0 锁定列；hanging indent 让行号落在列 0。 */
const lineNumberTransformer: ShikiTransformer = {
    name: 'mobi:line-numbers',
    line(node, line) {
        const ln = {
            type: 'element',
            tagName: 'span',
            properties: { className: ['ln'] },
            children: [{ type: 'text', value: String(line) }],
        } as typeof node
        node.children.unshift(ln)
    },
}

// 2 主题（懒加载）——包成函数，避免模块加载即触发 import() 拉主题 chunk
function loadThemes() {
    return [
        import('@shikijs/themes/github-light'),
        import('@shikijs/themes/github-dark'),
    ]
}

// ~25 常用语言（懒加载）——包成函数，仅首次高亮时触发，覆盖文件查看常见场景
function loadLangs() {
    return [
        import('@shikijs/langs/shellscript'),
        import('@shikijs/langs/json'),
        import('@shikijs/langs/yaml'),
        import('@shikijs/langs/toml'),
        import('@shikijs/langs/xml'),
        import('@shikijs/langs/ini'),
        import('@shikijs/langs/markdown'),
        import('@shikijs/langs/html'),
        import('@shikijs/langs/css'),
        import('@shikijs/langs/javascript'),
        import('@shikijs/langs/typescript'),
        import('@shikijs/langs/jsx'),
        import('@shikijs/langs/tsx'),
        import('@shikijs/langs/sql'),
        import('@shikijs/langs/c'),
        import('@shikijs/langs/rust'),
        import('@shikijs/langs/go'),
        import('@shikijs/langs/java'),
        import('@shikijs/langs/kotlin'),
        import('@shikijs/langs/python'),
        import('@shikijs/langs/php'),
        import('@shikijs/langs/swift'),
        import('@shikijs/langs/csharp'),
        import('@shikijs/langs/dockerfile'),
        import('@shikijs/langs/diff'),
    ]
}

// 单例 highlighter（首次调用懒加载 shiki 核心 + JS 正则引擎 + 主题 + 语言）
// shiki/core 与 engine 用 dynamic import，避免被静态拉进首屏 eager 图
// （shiki 核心 + 25 种语法 chunk 合计数百 KB，仅文件查看代码高亮需要，首屏不该下）
let highlighterPromise: Promise<HighlighterCore> | null = null
function getHighlighter(): Promise<HighlighterCore> {
    if (!highlighterPromise) {
        highlighterPromise = (async () => {
            const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] = await Promise.all([
                import('shiki/core'),
                import('shiki/engine/javascript'),
            ])
            return createHighlighterCore({
                themes: loadThemes(),
                langs: loadLangs(),
                engine: createJavaScriptRegexEngine({ forgiving: true }),
            })
        })()
    }
    return highlighterPromise
}

/**
 * 异步代码高亮（codeToHtml）：返回完整 `<pre><code>` HTML 字符串（主题内联色）。
 *
 * 文件查看为静态一次性高亮（非聊天流式），故：
 * - 用 codeToHtml + dangerouslySetInnerHTML，而非 hast → React 元素树（少装依赖）
 * - 单主题按 isDark 切，切主题重新高亮（< 1MB 静态文件可接受）
 * - 不加防抖（聊天流式场景才需要）
 *
 * 未加载语言 / text / 失败 → null（调用方 fallback 纯 `<pre>`）。
 */
export function useShikiHtml(code: string, language: string, isDark: boolean): string | null {
    const [html, setHtml] = useState<string | null>(null)
    useEffect(() => {
        let cancelled = false
        getHighlighter().then((highlighter) => {
            if (cancelled) return
            const loaded = highlighter.getLoadedLanguages()
            // 未加载语言 / 纯文本 → 不高亮，fallback 由调用方处理
            if (language === 'text' || !loaded.includes(language)) {
                setHtml(null)
                return
            }
            const out = highlighter.codeToHtml(code, {
                lang: language,
                theme: isDark ? SHIKI_THEME_DARK : SHIKI_THEME_LIGHT,
                transformers: [lineNumberTransformer],
            })
            if (!cancelled) setHtml(out)
        }).catch(() => { if (!cancelled) setHtml(null) })
        return () => { cancelled = true }
    }, [code, language, isDark])
    return html
}
