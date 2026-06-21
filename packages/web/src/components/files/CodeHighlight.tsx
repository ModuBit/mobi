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

import { useMemo } from 'react'
import { useShikiHtml } from '@/core/utils/shiki'
import { resolveFileLang } from '@/core/utils/fileLang'
import { useUiStore, resolveTheme } from '@/core/data/stores/uiStore'

interface CodeHighlightProps {
    /** 文件文本内容 */
    code: string
    /** 文件路径（用于推断语言） */
    filePath: string
}

/**
 * 文件查看代码高亮：
 * - Shiki codeToHtml（单主题，按 ui store isDark 切）输出 HTML 字符串，dangerouslySetInnerHTML 注入
 * - 未加载语言 / text / 高亮失败 → fallback 纯 `<pre>`（与 FileContentView 原文本分支样式一致）
 *
 * 首次渲染：highlighter 异步加载期间返回 null，先 fallback 纯 `<pre>`，加载完成后切到高亮版本。
 */
export default function CodeHighlight({ code, filePath }: CodeHighlightProps) {
    const isDark = useUiStore((s) => resolveTheme(s.theme) === 'dark')
    const lang = useMemo(() => resolveFileLang(filePath), [filePath])
    const html = useShikiHtml(code, lang, isDark)

    if (!html) {
        // fallback：纯文本，样式与 FileContentView 原文本分支对齐
        return (
            <pre style={{
                fontSize: 12,
                margin: 0,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                fontFamily: 'var(--font-mono)',
                padding: 12,
            }}>
                {code}
            </pre>
        )
    }

    return (
        <div
            className="shiki-wrap"
            style={{ fontSize: 12, fontFamily: 'var(--font-mono)' }}
            dangerouslySetInnerHTML={{ __html: html }}
        />
    )
}
