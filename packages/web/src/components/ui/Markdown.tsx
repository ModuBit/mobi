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

import { createContext, memo, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type FC } from 'react'
import { CodeHighlighter, Sources } from '@ant-design/x'
import { Popover, Tag } from 'antd'
import { XMarkdown, type ComponentProps, type XMarkdownProps } from '@ant-design/x-markdown'
import { useTranslation } from 'react-i18next'
import Latex from './latexPlugin'
import slashCommand from './slashCommandPlugin'
import { extractFootnotes, footnoteRefExtension, type FootnoteItem } from './footnotePlugin'
import oneDark from 'react-syntax-highlighter/dist/esm/styles/prism/one-dark'
import oneLight from 'react-syntax-highlighter/dist/esm/styles/prism/one-light'
import { detectLanguage, FALLBACK_LANGUAGE, getCachedDetectedLanguage } from '@/core/utils/codeLanguageDetect'
import { useUiStore, resolveTheme } from '@/core/data/stores/uiStore'

/** 脚注数据 Context，Markdown 组件注入，FootnoteRef 消费 */
const FootnoteContext = createContext<Map<number, FootnoteItem>>(new Map())

/** 流式渲染选项类型（从 XMarkdownProps 推断，因 x-markdown 未顶层导出） */
type StreamingOption = NonNullable<XMarkdownProps['streaming']>

/** 流式渲染默认配置：逐字揭示 + 短淡入 */
export const MARKDOWN_STREAMING_CONFIG: StreamingOption = {
    hasNextChunk: true,
    enableAnimation: true,
    animationConfig: { fadeDuration: 100 },
}

/** 逐字揭示基础速率（字符/毫秒），~120 chars/sec */
const STREAM_BASE_RATE = 0.1
/** 积压阈值：超过此字符数时自适应加速 */
const STREAM_CATCHUP_THRESHOLD = 50
/** 积压追赶帧数（≈30帧 ≈ 500ms，即一个 snapshot 间隔内追完） */
const STREAM_CATCHUP_FRAMES = 30

/**
 * 流式内容逐字揭示 hook。
 * 将批量到达的 snapshot 内容拆分为逐字显示，模拟打字机效果。
 * 自适应速率：积压时自动加速追平，追上后回落到基础速率。
 */
function useStreamingContent(target: string, streaming?: boolean): string {
    const [display, setDisplay] = useState(target)
    const targetRef = useRef(target)
    const revealedRef = useRef(target.length)
    const rafRef = useRef(0)

    useEffect(() => {
        targetRef.current = target

        // 非流式或新消息（内容缩短）→ 立即显示全部
        if (!streaming || target.length < revealedRef.current) {
            cancelAnimationFrame(rafRef.current)
            rafRef.current = 0
            revealedRef.current = target.length
            setDisplay(target)
            return
        }

        // 有未揭示内容且动画未在运行 → 启动
        if (revealedRef.current < target.length && rafRef.current === 0) {
            let lastTime = performance.now()
            let lastRender = lastTime
            const tick = (now: number) => {
                const dt = Math.max(now - lastTime, 1)
                lastTime = now

                const gap = targetRef.current.length - revealedRef.current
                const rate = gap > STREAM_CATCHUP_THRESHOLD
                    ? Math.max(STREAM_BASE_RATE, gap / STREAM_CATCHUP_FRAMES)
                    : STREAM_BASE_RATE
                const chars = Math.max(1, Math.round(rate * dt))
                revealedRef.current = Math.min(revealedRef.current + chars, targetRef.current.length)

                // 节流 DOM 更新到 ~20fps，避免 XMarkdown 高频重解析
                if (now - lastRender >= 50 || revealedRef.current >= targetRef.current.length) {
                    lastRender = now
                    setDisplay(targetRef.current.slice(0, revealedRef.current))
                }

                if (revealedRef.current < targetRef.current.length) {
                    rafRef.current = requestAnimationFrame(tick)
                } else {
                    rafRef.current = 0
                }
            }
            rafRef.current = requestAnimationFrame(tick)
        }
    }, [target, streaming])

    useEffect(() => () => cancelAnimationFrame(rafRef.current), [])

    return display
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

/** slash command badge 扩展 */
const SLASH_COMMAND_EXTENSIONS = [slashCommand()]

/** 脚注引用扩展（稳定引用，不依赖运行时数据） */
const FOOTNOTE_REF_EXTENSIONS = [footnoteRefExtension()]

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

/** 脚注引用组件：tag 样式 + hover 展示 title + 点击打开链接 */
const FootnoteRef: FC<ComponentProps<{ 'data-num'?: string }>> = ({ 'data-num': dataNum, children }) => {
    const footnotesMap = useContext(FootnoteContext)
    const num = parseInt(dataNum ?? '0', 10)
    const fn = footnotesMap.get(num)
    const title = fn?.title
    const href = fn?.url

    const handleClick = (e: React.MouseEvent) => {
        e.stopPropagation()
        if (href) window.open(href, '_blank', 'noopener,noreferrer')
    }

    const tag = (
        <sup className="footnote-ref" onClick={handleClick}>
            <Tag color="blue" style={{
                padding: '0 0.3em',
                marginLeft: '0.1em',
                lineHeight: '1.2em',
                cursor: href ? 'pointer' : 'default',
                textDecoration: 'none',
                userSelect: 'none',
                transition: 'background-color 0.2s',
            }}>
                {children}
            </Tag>
        </sup>
    )

    if (!title) return tag

    return (
        <Popover content={title} trigger="hover">
            {tag}
        </Popover>
    )
}

/** 脚注定义列表组件：使用 antx Sources 渲染 */
const FootnoteSources: FC<{ footnotes: FootnoteItem[] }> = ({ footnotes }) => {
    const { t } = useTranslation()
    const items = useMemo(
        () => footnotes.map((fn) => ({
            key: fn.key,
            title: `${fn.num}. ${fn.title}`,
            url: fn.url,
            description: fn.description,
        })),
        [footnotes],
    )

    return (
        <Sources
            style={{ marginTop: 8 }}
            title={t('chat.footnoteSources')}
            items={items}
            defaultExpanded
        />
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
    /**
     * 流式模式下是否启用逐字打字机效果：
     * - `true`（默认）：将 snapshot 批量内容逐字揭示，自适应速率
     * - `false`：直接传递完整内容，由 XMarkdown 的 enableAnimation 处理整体渐显
     */
    typing?: boolean
    /** 包裹容器的内联样式（默认 maxWidth: 100%） */
    style?: CSSProperties
    /**
     * 是否启用 slash command badge 渲染（如 `/compact`、`/board`）。
     * 仅在用户消息场景启用，避免工具输出中的 `/` 路径被误渲染。
     * 默认 `false`。
     */
    enableSlashCommand?: boolean
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
    typing = true,
    components,
    paragraphTag,
    className,
    style,
    config,
    enableSlashCommand = false,
    ...rest
}: MarkdownProps) {
    const useDrip = !!streaming && typing !== false
    const displayContent = useStreamingContent(content ?? '', useDrip)

    const streamingOption: StreamingOption | undefined = useMemo(() => {
        if (streaming === true) return MARKDOWN_STREAMING_CONFIG
        return streaming || undefined
    }, [streaming])

    const mergedComponents = useMemo(
        () => ({
            code: DefaultCode,
            'footnote-ref': FootnoteRef,
            ...(components ?? {}),
        }),
        [components],
    )

    const mergedClassName = useMemo(
        () => ['x-markdown', className].filter(Boolean).join(' '),
        [className],
    )

    const finalContent = useDrip ? displayContent : (content ?? '')

    // 提取脚注定义，清洗正文
    const { cleanContent, footnotes } = useMemo(
        () => extractFootnotes(finalContent),
        [finalContent],
    )

    // 仅在脚注数据实质变化时重建 Map，流式渲染期间保持稳定引用
    const footnotesRef = useRef(footnotes)
    const footnotesMapRef = useRef(new Map<number, FootnoteItem>())
    if (
        footnotes.length !== footnotesRef.current.length
        || footnotes.some((fn, i) =>
            fn.num !== footnotesRef.current[i]?.num
            || fn.title !== footnotesRef.current[i]?.title
            || fn.url !== footnotesRef.current[i]?.url)
    ) {
        footnotesMapRef.current = new Map(footnotes.map(fn => [fn.num, fn]))
        footnotesRef.current = footnotes
    }

    const mergedConfig = useMemo(() => {
        const slashExts = enableSlashCommand ? SLASH_COMMAND_EXTENSIONS : []
        const baseExts = [...FOOTNOTE_REF_EXTENSIONS, ...slashExts, ...LATEX_EXTENSIONS]
        if (!config) return { breaks: true, extensions: baseExts }
        return {
            breaks: true,
            ...config,
            extensions: [
                ...(Array.isArray(config.extensions) ? config.extensions : []),
                ...baseExts,
            ],
        }
    }, [config, enableSlashCommand])

    return (
        <FootnoteContext.Provider value={footnotesMapRef.current}>
            <div className={mergedClassName} style={{ maxWidth: '100%', ...style }}>
                <XMarkdown
                    {...rest}
                    content={cleanContent}
                    streaming={streamingOption}
                    components={mergedComponents}
                    paragraphTag={paragraphTag}
                    config={mergedConfig}
                />
                {footnotes.length > 0 && <FootnoteSources footnotes={footnotes} />}
            </div>
        </FootnoteContext.Provider>
    )
})
