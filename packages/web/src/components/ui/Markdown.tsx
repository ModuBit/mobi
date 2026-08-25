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

import { memo, useEffect, useMemo, useRef, useState, type CSSProperties, type FC } from 'react'
import { XMarkdown, type ComponentProps, type XMarkdownProps } from '@ant-design/x-markdown'
import Latex, { containsLatex, ensureKatexLoaded } from './latexPlugin'
import slashCommand from './slashCommandPlugin'
import mention from './mentionPlugin'
import { extractFootnotes, footnoteRefExtension, type FootnoteItem } from './footnotePlugin'
import { useStreamingContent } from './useStreamingContent'
import { splitStablePrefix } from '@/core/lib/markdownSplit'
import AutoDetectCodeBlock from './AutoDetectCodeBlock'
import { MermaidDiagram } from './MermaidDiagram'
import { FootnoteContext, FootnoteRef, FootnoteSources } from './FootnoteComponents'

/** 流式渲染选项类型（从 XMarkdownProps 推断，因 x-markdown 未顶层导出） */
type StreamingOption = NonNullable<XMarkdownProps['streaming']>

/** 流式渲染默认配置：逐字揭示 + 短淡入 */
export const MARKDOWN_STREAMING_CONFIG: StreamingOption = {
    hasNextChunk: true,
    enableAnimation: true,
    animationConfig: { fadeDuration: 100 },
}

/** 默认启用的 x-markdown 扩展（LaTeX 公式渲染）。
 *  renderer 内部引用动态加载的 katex 实例——只有 ensureKatexLoaded 完成后
 *  这些扩展才会进入渲染配置（见 katexReady 门控），工厂本身可同步创建 */
const LATEX_EXTENSIONS = Latex()

/** slash command badge 扩展 */
const SLASH_COMMAND_EXTENSIONS = [slashCommand()]

/** mention (@path) badge 扩展 */
const MENTION_EXTENSIONS = [mention()]

/** 脚注引用扩展（稳定引用，不依赖运行时数据） */
const FOOTNOTE_REF_EXTENSIONS = [footnoteRefExtension()]

/** 所有链接在新标签页打开 */
const ExternalLink: FC<ComponentProps<{ href?: string }>> = (
    { href, children, domNode, streamStatus, lang, block, ...rest },
) => (
    <a href={href} target="_blank" rel="noopener noreferrer" {...rest}>
        {children}
    </a>
)

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

    // mermaid 图：渲染为 mermaid 图（而非代码高亮），与编辑器一致
    if (explicit === 'mermaid') {
        return <MermaidDiagram code={children} />
    }

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
    /**
     * 是否启用 mention（`@<path>`）badge 渲染。
     * 仅在用户消息场景启用——mention 作为独立 token 优先于 GFM 删除线等 inline 语法，
     * 避免用户输入 `@~/a/b/c` 里的 `~` 被删除线吞掉。默认 `false`。
     */
    enableMention?: boolean
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
    enableMention = false,
    ...rest
}: MarkdownProps) {
    const useDrip = !!streaming && typing !== false
    const displayContent = useStreamingContent(content ?? '', useDrip)

    // LaTeX 按需加载：探测到公式特征才拉 katex chunk（raw ~234K，含样式），
    // 避免绝大多数不含公式的消息把 katex 带进会话页首载。加载是模块级幂等
    // （ensureKatexLoaded 缓存 promise），加载过后所有渲染一直带 Latex 扩展
    const [katexReady, setKatexReady] = useState(false)
    const needsKatex = useMemo(() => containsLatex(displayContent), [displayContent])
    useEffect(() => {
        if (!needsKatex || katexReady) return
        let cancelled = false
        ensureKatexLoaded().then(() => {
            if (!cancelled) setKatexReady(true)
        })
        return () => {
            cancelled = true
        }
    }, [needsKatex, katexReady])

    const streamingOption: StreamingOption | undefined = useMemo(() => {
        if (streaming === true) return MARKDOWN_STREAMING_CONFIG
        return streaming || undefined
    }, [streaming])

    const mergedComponents = useMemo(
        () => ({
            code: DefaultCode,
            a: ExternalLink,
            'footnote-ref': FootnoteRef,
            ...(components ?? {}),
        }),
        [components],
    )

    const mergedClassName = useMemo(
        () => ['x-markdown', className].filter(Boolean).join(' '),
        [className],
    )

    // 始终用 hook 输出：hook 内部区分历史全显 / 流式逐字 / 流式结束后继续逐字到收敛，
    // 避免 streaming 结束（full message 替换 snapshot）时直接跳到 content 全显覆盖逐字
    const finalContent = displayContent

    // 提取脚注定义，清洗正文（脚注定义从正文移除、集中到尾部 FootnoteSources 渲染）
    const { cleanContent, footnotes } = useMemo(
        () => extractFootnotes(finalContent),
        [finalContent],
    )

    // 增量渲染：揭示进行中（display 尚未追上 target）把已揭示内容拆成
    // 「稳定前缀（完成块）+ 活动尾部」。stable 段 content 值不变时被 XMarkdown 的
    // memo 浅比较短路（字符串按值比较）——零 re-parse 零 re-render，每帧只有
    // 尾部小块参与 parse。收敛后（display === content）回归单段渲染，
    // 流式中途插入的双段结构一次性归一（此时全文完成，单次全量 parse 可接受）。
    // 判据用 display 长度而非 streaming prop：full message 到达后 streaming 已翻
    // false，但 wasStreaming 的逐字收敛仍在进行（display 仍 < content），拆分必须继续。
    // 拆分基准是清洗后的 cleanContent（两段拼回 === cleanContent，正文不含脚注定义原文）
    const isDripping = displayContent.length < (content ?? '').length
    const { stable, tail } = useMemo(
        () => (isDripping ? splitStablePrefix(cleanContent) : { stable: '', tail: cleanContent }),
        [isDripping, cleanContent],
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
        const mentionExts = enableMention ? MENTION_EXTENSIONS : []
        // Latex 扩展仅在 katex 就绪后加入（未就绪时公式暂以原文展示，加载完成即渲染）
        const latexExts = katexReady ? LATEX_EXTENSIONS : []
        const baseExts = [...FOOTNOTE_REF_EXTENSIONS, ...slashExts, ...mentionExts, ...latexExts]
        if (!config) return { breaks: true, extensions: baseExts }
        return {
            breaks: true,
            ...config,
            extensions: [
                ...(Array.isArray(config.extensions) ? config.extensions : []),
                ...baseExts,
            ],
        }
    }, [config, enableSlashCommand, enableMention, katexReady])

    return (
        <FootnoteContext.Provider value={footnotesMapRef.current}>
            <div className={mergedClassName} style={{ maxWidth: '100%', ...style }}>
                {/* 稳定前缀：不传 streaming（无尾部动画/渐显），content 值不变即整体短路 */}
                {stable ? (
                    <XMarkdown
                        {...rest}
                        content={stable}
                        components={mergedComponents}
                        paragraphTag={paragraphTag}
                        config={mergedConfig}
                    />
                ) : null}
                <XMarkdown
                    {...rest}
                    content={tail}
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
