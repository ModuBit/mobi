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

import { useEffect, useState, type CSSProperties, type FC } from 'react'
import { CodeHighlighter } from '@ant-design/x'
import oneDark from 'react-syntax-highlighter/dist/esm/styles/prism/one-dark'
import oneLight from 'react-syntax-highlighter/dist/esm/styles/prism/one-light'
import { detectLanguage, FALLBACK_LANGUAGE, getCachedDetectedLanguage } from '@/core/utils/codeLanguageDetect'
import { useUiStore, resolveTheme } from '@/core/data/stores/uiStore'

/** 修正 prism 主题中 pre 默认 margin（与 CodeHighlighter 内部 customOneLight 一致） */
type PrismTheme = Record<string, CSSProperties>
function withZeroMargin(base: PrismTheme): PrismTheme {
    const preKey = 'pre[class*="language-"]'
    return {
        ...base,
        [preKey]: {
            ...base[preKey],
            margin: 0,
        },
    }
}
const ONE_DARK_THEME = withZeroMargin(oneDark as PrismTheme)
const ONE_LIGHT_THEME = withZeroMargin(oneLight as PrismTheme)

/**
 * 块级代码自动检测语言渲染：
 * - 显式 lang 优先
 * - 否则先以 'clike' 立即渲染（容器不抖动），再异步检测真实语言
 * - 主题跟随 ui store（dark / light）
 */
const AutoDetectCodeBlock: FC<{ code: string; explicitLang?: string }> = ({ code, explicitLang }) => {
    const isDark = useUiStore((state) => resolveTheme(state.theme) === 'dark')
    const [resolvedLang, setResolvedLang] = useState<string>(explicitLang ?? FALLBACK_LANGUAGE)

    useEffect(() => {
        if (explicitLang) {
            if (resolvedLang !== explicitLang) setResolvedLang(explicitLang)
            return
        }
        const cached = getCachedDetectedLanguage(code)
        if (cached !== undefined) {
            if (resolvedLang !== cached) setResolvedLang(cached)
            return
        }
        // 此时已经以 FALLBACK_LANGUAGE 兜底渲染，异步检测完成后切换到具体语言（容器不变，仅着色更新）
        let cancelled = false
        detectLanguage(code).then(detected => {
            if (!cancelled && resolvedLang !== detected) setResolvedLang(detected)
        })
        return () => {
            cancelled = true
        }
    }, [code, explicitLang])

    // prismLightMode={false}：避开 CodeHighlighter 的按需 lazy import
    // （`react-syntax-highlighter/dist/esm/languages/prism/${lang}` 模板路径在 Vite 下解析失败），
    // 改为一次性 import 主包获取全量 Prism。
    return (
        <CodeHighlighter
            lang={resolvedLang}
            prismLightMode={false}
            highlightProps={{ style: isDark ? ONE_DARK_THEME : ONE_LIGHT_THEME }}
        >
            {code}
        </CodeHighlighter>
    )
}

export default AutoDetectCodeBlock
