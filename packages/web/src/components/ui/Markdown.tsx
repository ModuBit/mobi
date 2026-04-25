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

import { memo, useEffect, useMemo, useState, type CSSProperties, type FC } from 'react'
import { CodeHighlighter } from '@ant-design/x'
import { XMarkdown, type ComponentProps, type XMarkdownProps } from '@ant-design/x-markdown'
import Latex from '@ant-design/x-markdown/plugins/Latex'
import oneDark from 'react-syntax-highlighter/dist/esm/styles/prism/one-dark'
import oneLight from 'react-syntax-highlighter/dist/esm/styles/prism/one-light'
import { detectLanguage, FALLBACK_LANGUAGE, getCachedDetectedLanguage } from '@/core/utils/codeLanguageDetect'
import { useUiStore, resolveTheme } from '@/core/data/stores/uiStore'

/** 流式渲染选项类型（从 XMarkdownProps 推断，因 x-markdown 未顶层导出） */
type StreamingOption = NonNullable<XMarkdownProps['streaming']>

/** 流式渲染默认配置：尾部光标 + 块级淡入 */
export const MARKDOWN_STREAMING_CONFIG: StreamingOption = {
    hasNextChunk: true,
    enableAnimation: true,
    tail: { content: '▋' },
    animationConfig: { fadeDuration: 500 },
}

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

/** 默认启用的 x-markdown 扩展（LaTeX 公式渲染） */
const LATEX_EXTENSIONS = Latex()

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

/** 默认的 code 渲染：块级走 CodeHighlighter（未指定 lang 时自动检测），行内保持原生 <code> */
const DefaultCode: FC<ComponentProps> = ({ block, lang, className, children }) => {
    if (typeof children !== 'string') return null

    if (!block) {
        return <code className={className}>{children}</code>
    }

    // info string 可能含额外参数（如 "ts twoslash"），仅取首个 token 作语言
    const explicit = (lang ?? '').split(/\s+/)[0]
        || className?.match(/language-([^\s]+)/)?.[1]
        || undefined

    return <AutoDetectCodeBlock code={children} explicitLang={explicit} />
}

export interface MarkdownProps extends Omit<XMarkdownProps, 'streaming' | 'content' | 'children'> {
    /** Markdown 文本内容 */
    content?: string
    /**
     * 流式渲染配置：
     * - `true`：使用默认 {@link MARKDOWN_STREAMING_CONFIG}
     * - 对象：自定义流式配置
     * - 省略 / `false` / `undefined`：非流式
     */
    streaming?: boolean | StreamingOption
    /** 包裹容器的内联样式（默认 maxWidth: 100%） */
    style?: CSSProperties
}

/**
 * 通用 Markdown 渲染组件，统一封装 XMarkdown：
 * - 默认接入代码高亮（CodeHighlighter）
 * - 默认补全 `.x-markdown` 容器类，沿用全局 inline code / 表格样式
 * - 流式渲染开箱即用
 *
 * 后续主题、扩展（数学公式、Mermaid 等）统一在这里增加配置。
 */
export const Markdown = memo(function Markdown({
    content,
    streaming,
    components,
    paragraphTag,
    className,
    style,
    config,
    ...rest
}: MarkdownProps) {
    const mergedComponents = useMemo(
        () => ({ code: DefaultCode, ...(components ?? {}) }),
        [components],
    )

    const streamingOption: StreamingOption | undefined = useMemo(() => {
        if (streaming === true) return MARKDOWN_STREAMING_CONFIG
        return streaming || undefined
    }, [streaming])

    const mergedClassName = useMemo(
        () => ['x-markdown', className].filter(Boolean).join(' '),
        [className],
    )

    const mergedConfig = useMemo(() => {
        if (!config) return { extensions: LATEX_EXTENSIONS }
        return {
            ...config,
            extensions: [
                ...(Array.isArray(config.extensions) ? config.extensions : []),
                ...LATEX_EXTENSIONS,
            ],
        }
    }, [config])

    return (
        <div className={mergedClassName} style={{ maxWidth: '100%', ...style }}>
            <XMarkdown
                {...rest}
                content={content ?? ''}
                streaming={streamingOption}
                components={mergedComponents}
                paragraphTag={paragraphTag}
                config={mergedConfig}
            />
        </div>
    )
})
