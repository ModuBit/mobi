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
 * Streamdown 渲染视图（新栈，flag 开启时由 Markdown 分发挂载）
 *
 * ticket 01 最小接入 + ticket 02 对齐旧行为：
 * - 链接：覆盖 components.a——Streamdown 默认把链接渲染成 button（配合 linkSafety），
 *   与现状（真 <a>，mobi:// 走 ActionLink 拦截，外链新标签页）不符，此处复位
 * - controls：表格无控件、代码块仅 copy（download 关）、图片无 overlay——对齐现状观感
 *   （代码块完整行为——语言检测/shiki 双主题——在 ticket 07 收口）
 * - lineNumbers 关：现状无行号
 * - LaTeX/slash/mention/脚注插件在后续 ticket 逐项补齐；动画在 ticket 08
 *
 * 输入内容已由 Markdown 统一经 useStreamingContent 平滑层揭示（双栈共用），此处
 * 只负责把「揭示进行中」绑定到 isAnimating（后续动画插件依赖该信号进出管线）。
 * linkSafety 关闭：与现状对齐（外链直接新标签页打开，不做拦截确认），决策见 spec。
 */

import { memo, useEffect, useMemo, useState, type CSSProperties, type FC } from 'react'
import { Streamdown, type Components, type PluginConfig } from 'streamdown'
import { MOBI_URI_SCHEME } from '@mobi/shared'
import { ActionLink } from './ActionLink'
import { FootnoteRef } from './FootnoteComponents'
import { normalizeLatexSyntax } from './latexSyntax'
import { ensureKatexLoaded } from './latexPlugin'
import { wrapFootnoteRefs } from './footnotePlugin'
import {
    preprocessUserSyntax,
    USER_SYNTAX_ALLOWED_TAGS,
    USER_SYNTAX_LITERAL_TAGS,
} from './streamdownUserSyntax'

/** linkSafety 关闭（模块级常量保持稳定引用，不因每帧重建打破 Streamdown 内部 memo） */
const LINK_SAFETY_OFF = { enabled: false } as const

/** 控件可见性：表格无控件 / 代码块仅 copy / 图片无 overlay（对齐旧栈观感） */
const CONTROLS = {
    table: false,
    code: { copy: true, download: false },
    image: false,
} as const

/** mobi URI scheme 前缀（同 Markdown.tsx 旧栈，scheme 大小写不敏感按 URI 惯例归一后识别） */
const MOBI_URI_PREFIX = `${MOBI_URI_SCHEME}://`

/**
 * 链接渲染（components.a 覆盖）：mobi:// 内部动作链接交 ActionLink 拦截分发
 * （ADR 0003），其余统一新标签页打开——与旧栈 ExternalLink 语义一致
 */
const MdLink: FC<React.ComponentPropsWithoutRef<'a'> & { node?: unknown }> = ({ href, children, ...rest }) => {
    if (href?.toLowerCase().startsWith(MOBI_URI_PREFIX)) {
        return <ActionLink uri={href}>{children}</ActionLink>
    }
    return (
        <a href={href} target="_blank" rel="noopener noreferrer" {...rest}>
            {children}
        </a>
    )
}

/** 组件覆盖表（模块级常量保持稳定引用） */
/** 自定义标签组件的 props（hast 属性经 sanitize 后为 unknown，渲染处收窄；须兼容 Components 的 Record 约束） */
type UserSyntaxTagProps = { uri?: unknown; children?: unknown } & Record<string, unknown>

const COMPONENTS: Components = {
    a: MdLink,
    // 用户消息 badge（ticket 04，TextBlock 路径启用；tag 由 streamdownUserSyntax 预处理产出）
    mention: ({ uri, children }: UserSyntaxTagProps) => (
        <ActionLink uri={String(uri ?? '')} className="mention-badge">{children as React.ReactNode}</ActionLink>
    ),
    'slash-command': ({ children }: UserSyntaxTagProps) => (
        <span className="slash-command-badge">{children as React.ReactNode}</span>
    ),
    // 脚注引用（ticket 05）：hast data-* 属性名可能以驼峰或原样抵达，两种形态都接
    'footnote-ref': (props: UserSyntaxTagProps) => {
        const num = (props['data-num'] ?? props.dataNum) as string | undefined
        return <FootnoteRef data-num={num}>{num}</FootnoteRef>
    },
}

/**
 * math 插件懒加载（ticket 03）：@streamdown/math = remark-math + rehype-katex，
 * 后者静态依赖 katex——若模块顶层的 import 会让 katex 进入 StreamdownView chunk
 * 依赖图，任何消息（含无公式）都拉 katex chunk，违反「不含公式不加载」的按需约定。
 * 故只在探测到公式特征（mathEnabled）后动态 import 插件模块；katex 本体与样式
 * 复用 latexPlugin 的 ensureKatexLoaded（同一 npm 包实例 + CSS chunk，无双份）。
 */
let mathPluginPromise: Promise<PluginConfig> | null = null
function loadMathPlugin(): Promise<PluginConfig> {
    if (!mathPluginPromise) {
        mathPluginPromise = Promise.all([
            import('@streamdown/math'),
            ensureKatexLoaded(),
        ]).then(([mod]) => ({ math: mod.createMathPlugin({ singleDollarTextMath: true }) }))
    }
    return mathPluginPromise
}

/** 新栈容器类：streamdown.css 的设计令牌作用域 + 排版映射的挂点 */
export const STREAMDOWN_CONTAINER_CLASS = 'streamdown-md'

export const StreamdownView = memo(function StreamdownView({
    content,
    isAnimating,
    mathEnabled = false,
    enableSlashCommand = false,
    enableMention = false,
    className,
    style,
}: {
    content: string
    /** 揭示进行中（平滑层缓冲未收敛 / 流式未结束），驱动 Streamdown 流式语义 */
    isAnimating?: boolean
    /** 内容探测到 LaTeX 特征（containsLatex），按需加载 math 插件 */
    mathEnabled?: boolean
    /** 用户消息 `/命令` badge（TextBlock 路径启用，语义同旧栈 Markdown props） */
    enableSlashCommand?: boolean
    /** 用户消息 `@路径` mention badge（TextBlock 路径启用） */
    enableMention?: boolean
    /** 追加到容器的外部类名（透传自 Markdown.className） */
    className?: string
    /** 容器内联样式（透传自 Markdown.style） */
    style?: CSSProperties
}) {
    // math 插件懒加载：未就绪时公式以原文展示（与旧栈 katexReady 门控同一 UX），加载完成即渲染
    const [mathPlugins, setMathPlugins] = useState<PluginConfig | null>(null)
    useEffect(() => {
        if (!mathEnabled || mathPlugins) return
        let cancelled = false
        loadMathPlugin().then((plugins) => {
            if (!cancelled) setMathPlugins(plugins)
        })
        return () => {
            cancelled = true
        }
    }, [mathEnabled, mathPlugins])

    // 自研定界归一只在 math 插件就绪后做：未就绪时转换会把原文变成裸 $$（更糟），
    // 就绪后转换 + 渲染同步生效。已配对 $...$ 等合法语法归一为零改动
    const normalizedContent = mathPlugins ? normalizeLatexSyntax(content) : content

    // 用户消息专属语法（slash/mention）预处理：parse 前包进 literal 自定义标签
    const userSyntaxContent = useMemo(
        () => preprocessUserSyntax(normalizedContent, { enableSlashCommand, enableMention }),
        [normalizedContent, enableSlashCommand, enableMention],
    )

    // 脚注引用预处理：parse 前包进 literal 自定义标签（防 remark-gfm 内置脚注解析双重消费）
    const displayContent = useMemo(() => wrapFootnoteRefs(userSyntaxContent), [userSyntaxContent])

    return (
        <div
            className={[STREAMDOWN_CONTAINER_CLASS, className].filter(Boolean).join(' ')}
            style={{ maxWidth: '100%', ...style }}
        >
            <Streamdown
                mode="streaming"
                isAnimating={isAnimating}
                linkSafety={LINK_SAFETY_OFF}
                controls={CONTROLS}
                lineNumbers={false}
                components={COMPONENTS}
                plugins={mathPlugins ?? undefined}
                allowedTags={USER_SYNTAX_ALLOWED_TAGS}
                literalTagContent={USER_SYNTAX_LITERAL_TAGS}
            >
                {displayContent}
            </Streamdown>
        </div>
    )
})

export default StreamdownView
