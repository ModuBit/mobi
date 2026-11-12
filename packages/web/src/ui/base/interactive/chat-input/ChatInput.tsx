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

import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, type CSSProperties, type Ref } from 'react'
import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { common, createLowlight } from 'lowlight'
import { Markdown } from '@tiptap/markdown'
import { Underline } from '@tiptap/extension-underline'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import { TextSelection } from '@tiptap/pm/state'
import type { Node as PMNode } from '@tiptap/pm/model'
import { getTextBetween, getTextSerializersFromSchema, type AnyExtension, type JSONContent } from '@tiptap/core'
import { isComposingEvent } from '@/core/lib/inputEnterKeys'
import type { ComposerQuoteRef, PendingQuoteRef } from '@/domain/chat/composerSegments'
import { normalizeEditorText } from './chatInputText'
import { resolveNewlineAction } from './newlinePolicy'
import { looksLikeMarkdownBlock } from './richText/markdownPaste'
import { LinkWithInputRule } from '@/ui/base/markdown/LinkWithInputRule'
import {
    addQuoteToEditor,
    collectQuotesFromDoc,
    insertQuotesAtEnd,
    updateQuoteCommentInEditor,
} from '@/ui/shared/chat-input-quote/chatInputQuoteDoc'
import './chat-input.css'

/** 行高常量：对齐现 Sender 输入区视觉（14px 字号 / 22px 行高），min/max 行数 → 像素换算 */
const LINE_HEIGHT_PX = 22

/**
 * 代码块语法高亮（lowlight/common 常用语言；配色复用全局 styles/highlight.css 的
 * hljs 双档主题）。模块级单例与 MarkdownEditorView 同款——lowlight 只读注册表，可共享。
 */
const lowlight = createLowlight(common)

/** 程序化写入 meta 标记：区分 setText/setEditorStateJSON 等程序写入与用户输入（防 onUpdate 回环误消费） */
const PROGRAMMATIC_META = 'chat-input-programmatic'

/**
 * 下划线：wire 协议要求 `<u>x</u>`（Underline 默认序列化为 `++x++`）。
 * helpers.renderChildren 必须调用——否则嵌套在 underline 内的粗体等 marks 会丢。
 */
const UnderlineWithMarkdown = Underline.extend({
    renderMarkdown(node, helpers) {
        return `<u>${helpers.renderChildren(node)}</u>`
    },
})


/** doc 中装配节点的实例数（extraNodeCount 派生源；未装节点恒 0） */
function countExtraNodes(doc: PMNode, names: Set<string>): number {
    if (names.size === 0) return 0
    let count = 0
    doc.descendants((node) => {
        if (names.has(node.type.name)) count++
        return true
    })
    return count
}

/** schema → 文本序列化器映射：schema 每个 editor 实例稳定，跨 update 复用（避免每键重建） */
const serializerCache = new WeakMap<object, ReturnType<typeof getTextSerializersFromSchema>>()
function serializersFor(schema: Editor['schema']): ReturnType<typeof getTextSerializersFromSchema> {
    let serializers = serializerCache.get(schema)
    if (!serializers) {
        serializers = getTextSerializersFromSchema(schema)
        serializerCache.set(schema, serializers)
    }
    return serializers
}

/** 光标前的纯文本长度（getText 段落语义单源；onUpdate 与 setCursorOffset 共用） */
function textLengthBefore(doc: PMNode, pos: number, serializers: ReturnType<typeof getTextSerializersFromSchema>): number {
    return getTextBetween(doc, { from: 0, to: pos }, { blockSeparator: '\n', textSerializers: serializers }).length
}

/**
 * 纯文本 offset → 文档位置（与 cursorOffset 同一定义：getTextBetween(0, pos) 长度 === offset）。
 * 只映射文本节点：offset 落在 chip 的降级文本区间时落到其后文本节点起点，不会插进 atom 内部。
 * 空文档/越界返回 null，调用方回落到文档末尾。
 */
function positionAtOffset(
    doc: PMNode,
    offset: number,
    serializers: ReturnType<typeof getTextSerializersFromSchema>,
): number | null {
    let target: number | null = null
    doc.descendants((node, pos) => {
        if (target != null || !node.isText) return true
        const before = textLengthBefore(doc, pos, serializers)
        if (before + node.nodeSize >= offset) {
            target = Math.max(pos, pos + (offset - before))
            return false
        }
        return true
    })
    return target
}

/** 编辑器更新上下文（ChatInput.onUpdate 载荷；消费方桥接层按需收窄） */
export interface ChatInputUpdateContext {
    text: string
    programmatic: boolean
    cursorOffset: number
    extraNodeCount: number
    editorStateJSON: string
}

export interface ChatInputProps {
    placeholder?: string
    /** 覆盖层语义禁用（editable=false + aria-disabled；不承诺 blur——真机焦点语义在票 02 验收） */
    disabled?: boolean
    /** 最小可见行数（CSS min-height 换算），默认 1 */
    minRows?: number
    /** 最大可见行数（超出滚动），默认 5 */
    maxRows?: number
    /** 提交键位：'enter'（PC）| 'shiftEnter'（触屏），默认 'enter' */
    submitKey?: 'enter' | 'shiftEnter'
    /** 提交谓词通过后回调（IME 组合中绝不触发；修饰键 Ctrl/Alt/Meta 组合不放行） */
    onSubmit?: () => void
    /** 原生键盘事件转发（消费方处理 Tab/Esc/Ctrl+C/方向键）；返回 true 表示已消费，跳过内置 Enter 判定 */
    onKeyDown?: (e: KeyboardEvent) => boolean | void
    /** 内容变化；programmatic=true 表示来自 setText/setEditorStateJSON 等程序化写入；
     *  cursorOffset = 光标前的纯文本长度（'\n' 分段计 1，与 getText 同语义）——
     *  mention/slash 的 (text, cursorPos) 模型对接用；
     *  editorStateJSON = 当前 doc 序列化快照（草稿持久化用：消费方镜像持有，
     *  卸载清理时 handle ref 已被 React 置 null，不能再回调本组件） */
    onUpdate?: (ctx: ChatInputUpdateContext) => void
    /** 编辑器实例就绪（immediatelyRender:false 异步挂载完成）后回调一次 */
    onReady?: () => void
    /** 内嵌自定义节点（装配注入，如引用 chip 节点）；默认不装——ui 层不感知业务节点类型 */
    extraNodes?: AnyExtension[]
    /** 粘贴事件（消费方分流文件粘贴）；返回 true 阻止默认 */
    onPaste?: (e: ClipboardEvent) => boolean | void
    className?: string
    style?: CSSProperties
    'aria-label'?: string
}

/**
 * 聊天输入框 Handle：命令式通道（编辑器是 source of truth，非受控）。
 * editor 未就绪（挂载首帧）时全部方法 no-op。
 */
export interface ChatInputHandle {
    focus(options?: { preventScroll?: boolean }): void
    /** 纯文本（段落分隔符统一 '\n'，与 textarea 语义一致） */
    getText(): string
    getEditorStateJSON(): string
    /** 程序化整体替换（三原则：meta 标记 + addToHistory:false + 光标置尾） */
    setText(text: string): void
    /** 解析失败静默降级为 no-op（调用方自己兜底 setText） */
    setEditorStateJSON(json: string): void
    /** 在当前光标处插入纯文本，光标落插入内容之后 */
    insertAtCursor(text: string): void
    /**
     * 程序化替换纯文本区间 [from, to)（offset 与 cursorOffset 同语义），**保留 extra 节点**。
     * 供面板选中插回/归一写回使用：整档 setText 会销毁文档里的引用 chip。
     */
    replaceTextRange(from: number, to: number, text: string): void
    /** 把光标移到纯文本 offset 处（与 onUpdate ctx.cursorOffset 同语义；越界/空文档置尾） */
    setCursorOffset(offset: number): void
    /** 编辑器是否已就绪（程序化写入前的判据；未就绪时其余方法均为 no-op） */
    isReady(): boolean
    /** wire 正文（Markdown 序列化；引用 chip 由节点级 renderMarkdown 排除；发送用） */
    getWireText(): string
    /** 按文档顺序收集引用条目（编辑器未就绪返回空数组） */
    getQuotes(): ComposerQuoteRef[]
    /** 插入一条引用（同消息同文本去重、达上限拒绝）；返回落位条目，未就绪/上限返回 null */
    addQuote(quote: PendingQuoteRef): ComposerQuoteRef | null
    /** 按 uid 更新/清空某条引用的评论；返回是否命中 */
    updateQuoteComment(uid: string, comment: string | undefined): boolean
    /** 在文档末尾回填一组引用（回填数据无 uid，内部补） */
    insertQuotesAtEnd(quotes: PendingQuoteRef[]): void
    /** 编辑器实例逃生舱（**仅测试与节点级断言使用，业务层禁止调用**——业务操作走上面的 Handle 方法）；未就绪返回 null */
    getEditor(): Editor | null
    clear(): void
}

/**
 * TipTap 封装的聊天输入框（ui 层零业务语义）：多行 contentEditable、placeholder、
 * Enter/Shift+Enter 提交谓词（IME 守卫）、高度自适应（min/max 行）、disabled 语义。
 *
 * - 非受控：编辑器是 source of truth；消费方经 onUpdate 维护 text 镜像派生（canSend 等）
 * - 程序化写入三原则（Claude Desktop 同款）：transaction meta 标记区分程序写入 /
 *   addToHistory:false 防污染 undo 栈 / 写入后光标置尾
 * - hardBreak 关闭：换行一律走段落分隔，getText({ blockSeparator:'\n' }) 语义单源
 */
export function ChatInput({
    placeholder,
    disabled,
    minRows = 2,
    maxRows = 10,
    submitKey = 'enter',
    onSubmit,
    onKeyDown,
    onUpdate,
    onPaste,
    onReady,
    extraNodes,
    className,
    style,
    'aria-label': ariaLabel,
    ref,
}: ChatInputProps & { ref?: Ref<ChatInputHandle> }) {
    // 回调与动态 props 走 ref 持有：editor options 只求值一次，回调读 ref 保证始终最新
    // （MarkdownEditorView 的 onChangeRef 同款）；placeholderRef 供 Placeholder 扩展函数读取
    const propsRef = useRef({ onSubmit, onKeyDown, onUpdate, onPaste, placeholder, submitKey })
    propsRef.current = { onSubmit, onKeyDown, onUpdate, onPaste, placeholder, submitKey }
    const onReadyRef = useRef(onReady)
    onReadyRef.current = onReady

    // editor 实例 ref：editorProps 回调在 options 求值时创建，闭包捕获不到后续就绪的 editor——经 ref 读取
    const editorRef = useRef<Editor | null>(null)

    // 装配注入的业务节点名集合：随 extraNodes 变化（页面级稳定），每键重建无意义
    const extraNodeNames = useMemo(
        () => new Set((extraNodes ?? []).map((n) => n.name)),
        [extraNodes],
    )

    /**
     * 键位层（顺序固定）：IME 守卫 → 消费方接管 → Enter 判定
     * （提交键位语义抄 antx TextArea.js：修饰键不放行、submitKey 分流）。
     * 换行键（PC Shift+Enter / 触屏 Enter）按光标上下文分流（newlinePolicy）：
     * 代码内换行 / 列表新建条目 / 空条目退出 / 标题末尾落普通段落 / 新段落。
     * 代码块内 Tab/Shift-Tab 由 CodeBlockLowlight 的 enableTabIndentation 处理
     * （仅 parent 是 codeBlock 时生效，低于本层）。
     *
     * IME 守卫必须在消费方之前：组合中的 Enter/Escape 是输入法确认/取消候选词，
     * 被面板当成「选中/关闭」抢走会让中文输入无法落字。
     */
    const handleKeyDown = useCallback((event: KeyboardEvent): boolean => {
        // 1. IME 组合残留：isComposing + keyCode 229 兜底，放行给编辑器/输入法
        if (isComposingEvent({ nativeEvent: event })) return false
        // 2. 消费方接管（面板导航/快捷键等）
        if (propsRef.current.onKeyDown?.(event) === true) return true
        if (event.key !== 'Enter') return false
        // 3. 修饰键组合不放行提交（Ctrl+Enter 等留给消费方）
        if (event.ctrlKey || event.altKey || event.metaKey) return false
        // 4. 提交谓词（submitKey 平移自 antx Sender 的 submitType）
        const sk = propsRef.current.submitKey ?? 'enter'
        const shouldSubmit = (sk === 'enter' && !event.shiftKey) || (sk === 'shiftEnter' && event.shiftKey)
        if (shouldSubmit) {
            event.preventDefault()
            propsRef.current.onSubmit?.()
            return true
        }
        // 5. 换行键：上下文分流（PC Shift+Enter / 触屏裸 Enter 都到这里）
        const ed = editorRef.current
        if (!ed) return false
        event.preventDefault()
        switch (resolveNewlineAction(ed.state)) {
            case 'newlineInCode':
                ed.commands.newlineInCode()
                break
            case 'splitListItem':
                ed.commands.splitListItem('listItem')
                break
            case 'liftListItem':
                ed.commands.liftListItem('listItem')
                break
            case 'exitHeading':
                ed.chain().splitBlock().setParagraph().run()
                break
            default:
                ed.commands.splitBlock()
        }
        return true
    }, [])

    // editor options 引用稳定：useEditor 每次渲染都会比较 options，内联对象/数组会触发
    // setOptions → view.setProps + updateState（流式/逐键渲染下的额外 ProseMirror 遍历）
    const editorProps = useMemo(() => ({
        attributes: {
            role: 'textbox',
            'aria-multiline': 'true',
            spellcheck: 'false',
            ...(ariaLabel ? { 'aria-label': ariaLabel } : {}),
        },
        handleKeyDown: (_view: unknown, event: KeyboardEvent) => handleKeyDown(event),
        /**
         * 粘贴管线（顺序固定，见 spec「粘贴优先级」）：
         * 1. 消费方附件钩子（文件/图片 → 上传；超长文本 → .txt 附件）——返回 true 即已消费；
         * 2. 剪贴板带 text/html → 放行给 ProseMirror 默认解析（schema 白名单，表格由 Table 扩展解析）；
         * 3. 纯文本含 Markdown 块级结构 → 就地转富文本（行内标记不转，避免代码误渲染）；
         * 4. 其余放行默认纯文本插入。
         */
        handlePaste: (_view: unknown, event: ClipboardEvent) => {
            const handler = propsRef.current.onPaste
            if (handler && handler(event) === true) return true
            const clipboardData = event.clipboardData
            if (!clipboardData) return false
            if (clipboardData.getData('text/html')) return false
            const text = clipboardData.getData('text/plain')
            const ed = editorRef.current
            if (ed && text && looksLikeMarkdownBlock(text)) {
                event.preventDefault()
                // 就地插入（不整档 setContent）：保留既有正文与引用 chip
                ed.commands.insertContent(text, { contentType: 'markdown' })
                return true
            }
            return false
        },
    }), [ariaLabel, handleKeyDown])

    const editorOptions = useMemo(() => ({
        // SSR/水合安全（MarkdownEditorView 同款）：首帧不渲染编辑器，挂载后异步就绪
        immediatelyRender: false,
        injectCSS: false,
        // editable 初始态；运行时切换由下方 effect 走 setEditable（不重建 editor）
        editable: !disabled,
        // 行内 marks + 块级结构（标题 h1–h3/列表/引用/代码块/链接/下划线）：输入规则与快捷键
        // 由扩展自带；hardBreak 关闭 = 换行一律走上下文命令（newlinePolicy），
        // getText 段落语义单源
        // 粘贴规则只留 link：StarterKit 的 bold/italic/strike 自带 markPasteRule，会把纯文本里的
        // `*x*`/`**x**`/`~~x~~` 转成 mark（代码粘贴被误渲染）；行内 Markdown 按 spec 须原样保留。
        // link 保留 = 粘贴裸 URL 自动变链接（linkOnPaste 语义）
        enablePasteRules: ['link'],
        extensions: [
            StarterKit.configure({
                heading: { levels: [1, 2, 3] }, hardBreak: false, horizontalRule: false,
                // 内置 codeBlock 关闭：改用下方 CodeBlockLowlight（围栏语言 → hljs 着色，
                // 与 EditorContent 里看到的消息气泡代码块认知一致）
                codeBlock: false,
                // 内置 link 关闭：改用下方 LinkWithInputRule（带 [text](url) 打字规则）
                link: false,
                // 内置 underline 关闭：改用下方 UnderlineWithMarkdown（wire 协议 <u>）
                underline: false,
                dropcursor: false, gapcursor: false, // undoRedo 保持默认启用（v3 options 只接受 false|配置对象，开=省略）
            }),
            // 高亮只是 Decorations，不进 doc：wire 序列化仍是 ```lang 围栏（CodeBlock 的
            // markdownTokenName/parseMarkdown/renderMarkdown 被继承），语言信息不丢。
            // defaultLanguage: plaintext——无语言围栏不做 highlightAuto（37 个语法全量试跑
            // 会随每次按键执行）；enableTabIndentation 接管代码块内 Tab/Shift-Tab
            CodeBlockLowlight.configure({
                lowlight,
                defaultLanguage: 'plaintext',
                enableTabIndentation: true,
                tabSize: 2,
            }),
            LinkWithInputRule.configure({ autolink: true, linkOnPaste: true, openOnClick: false }),
            UnderlineWithMarkdown,
            // 表格：只用于粘贴保留（无输入规则、无增删行列 UI，不做表格创作）
            Table.configure({ resizable: false, lastColumnResizable: false }),
            TableRow,
            TableCell,
            TableHeader,
            // wire 序列化单源：editor.getMarkdown() 把 doc 转 Markdown（含 marks/块级/表格）。
            // breaks:false——软换行按段落语义，不生成 <br>（composer 换行一律 splitBlock）
            Markdown.configure({ markedOptions: { gfm: true, breaks: false } }),
            // 函数形式读 ref：动态文案（bash 模式占位切换）不重建 editor
            Placeholder.configure({
                placeholder: () => propsRef.current.placeholder ?? '',
            }),
            // 装配注入的业务节点（引用 chip 等）：ui 层零业务，节点实现由消费方提供
            ...(extraNodes ?? []),
        ],
        editorProps,
        onUpdate: ({ editor, transaction }: { editor: Editor; transaction: { getMeta: (key: string) => unknown } }) => {
            // offset/降级文本同源：getTextBetween 吃 schema 的 toText 序列化器
            // （节点 renderText 落 schema.toText）——chip 的「excerpt」在 getText 与
            // cursorOffset 两侧一致，面板检测的 cursorPos 不错位
            propsRef.current.onUpdate?.({
                text: normalizeEditorText(editor.getText({ blockSeparator: '\n' })),
                programmatic: transaction.getMeta(PROGRAMMATIC_META) === true,
                cursorOffset: textLengthBefore(editor.state.doc, editor.state.selection.from, serializersFor(editor.schema)),
                extraNodeCount: countExtraNodes(editor.state.doc, extraNodeNames),
                editorStateJSON: JSON.stringify(editor.getJSON()),
            })
        },
        // 先把实例交给 ref 再通知就绪：onCreate 在 useEditor 的创建路径内同步触发，
        // 早于组件下一次渲染对 editorRef 的赋值——否则 onReady 里的 handle 调用全是 no-op
        onCreate: ({ editor }: { editor: Editor }) => { editorRef.current = editor; onReadyRef.current?.() },
        // disabled 入 deps：editable 初值随禁用态快照（运行时切换仍由下方 effect 负责）
    }), [extraNodes, extraNodeNames, editorProps, disabled])

    const editor = useEditor(editorOptions)
    // 每渲染同步（挂载后 editor 由 null → 实例触发重渲染，ref 随之就位）
    editorRef.current = editor

    /** 纯文本 → doc JSON：setContent(string) 走 HTML 解析（纯文本含 '<' 会误解析成节点），手工构建规避 */
    const buildTextDoc = (text: string): JSONContent => ({
        type: 'doc',
        content: (text === '' ? [''] : text.split('\n')).map((line) => ({
            type: 'paragraph',
            ...(line ? { content: [{ type: 'text', text: line }] } : {}),
        })),
    })

    // 程序化写入三原则：meta 标记（防 onUpdate 回环误消费）+ addToHistory:false（防污染
    // undo 栈）+ 写入后光标置尾（TextSelection.atEnd）；emitUpdate:true 让 onUpdate 正常发出
    const replaceDoc = (content: JSONContent) => {
        const ed = editorRef.current
        if (!ed) return
        ed.chain()
            .command(({ tr }) => {
                tr.setMeta(PROGRAMMATIC_META, true)
                tr.setMeta('addToHistory', false)
                return true
            })
            .setContent(content, { emitUpdate: true })
            .command(({ tr }) => {
                tr.setSelection(TextSelection.atEnd(tr.doc))
                return true
            })
            .run()
    }

    const setText = (text: string) => replaceDoc(buildTextDoc(text))

    const setEditorStateJSON = (json: string) => {
        let parsed: JSONContent
        try {
            parsed = JSON.parse(json) as JSONContent
        } catch {
            return // 非法 JSON 静默降级为 no-op（调用方自己兜底 setText）
        }
        const ed = editorRef.current
        if (!ed) return
        try {
            // schema 校验：不认识的节点/结构在这里抛错。不能直接交给 setContent——
            // TipTap 解析失败会静默降级为空文档，反而把调用方的 setText 文本兜底清掉
            ed.schema.nodeFromJSON(parsed)
        } catch {
            return // 快照与当前 schema 不兼容：保留当前文档（文本兜底已生效）
        }
        replaceDoc(parsed)
    }

    // Handle 全走 editorRef 读取（deps 留空，方法体无闭包过期风险）
    useImperativeHandle(ref, () => ({
        focus: (options?: { preventScroll?: boolean }) => {
            // 直接 DOM focus 透传 preventScroll（发送后恢复焦点的滚动抑制）——
            // TipTap focus() 的 options 只有 scrollIntoView，不收 preventScroll；
            // PM 光标 selection 独立于 DOM 焦点，重新聚焦后光标原地保持
            editorRef.current?.view.dom.focus({ preventScroll: options?.preventScroll })
        },
        getText: () => normalizeEditorText(editorRef.current?.getText({ blockSeparator: '\n' }) ?? ''),
        getEditorStateJSON: () => (editorRef.current ? JSON.stringify(editorRef.current.getJSON()) : ''),
        setText,
        setEditorStateJSON,
        // 用户语义的插入（mention/slash 选中插回）：不打 programmatic meta、不关 addToHistory
        insertAtCursor: (text: string) => {
            // JSON text 节点插入，规避 insertContent(string) 的 HTML 解析歧义
            editorRef.current?.chain().focus().insertContent({ type: 'text', text }).run()
        },
        /**
         * 光标定位到纯文本 offset（与 onUpdate ctx.cursorOffset 对称的定义：
         * getTextBetween(0, pos) 长度 === offset，降级文本同源）。doc 顺序扫描文本节点，
         * 找到累计长度首次覆盖 offset 的节点内部位置；无文本节点（空文档/越界）置尾。
         */
        setCursorOffset: (offset: number) => {
            const ed = editorRef.current
            if (!ed) return
            const doc = ed.state.doc
            const target = positionAtOffset(doc, offset, serializersFor(ed.schema))
            ed.commands.setTextSelection(target ?? TextSelection.atEnd(doc).from)
        },
        replaceTextRange: (from, to, text) => {
            const ed = editorRef.current
            if (!ed) return
            const doc = ed.state.doc
            const serializers = serializersFor(ed.schema)
            const fallback = TextSelection.atEnd(doc).from
            const fromPos = positionAtOffset(doc, Math.max(0, from), serializers) ?? fallback
            const toPos = positionAtOffset(doc, Math.max(0, to), serializers) ?? fallback
            if (toPos < fromPos) return
            const tr = ed.state.tr
            // 程序化通道：面板/归一不得因这次写回再次触发（onUpdate 会带 programmatic 标记）
            tr.setMeta(PROGRAMMATIC_META, true)
            tr.setMeta('addToHistory', false)
            if (toPos > fromPos) tr.delete(fromPos, toPos)
            const insertAt = Math.min(fromPos, tr.doc.content.size - 1)
            if (text) tr.insertText(text, insertAt)
            tr.setSelection(TextSelection.create(tr.doc, Math.min(insertAt + text.length, tr.doc.content.size - 1)))
            ed.view.dispatch(tr)
        },
        isReady: () => editorRef.current != null,
        getWireText: () => {
            const ed = editorRef.current
            if (!ed) return ''
            // 只有格式没有文字（空列表项 / 空引用块）：Markdown 序列化会残留 "-" ">" 等
            // 块标记，不能当作可发送正文——正文存在性以纯文本为准（引用 chip 无 textContent，
            // 由 quotes 分段承载）
            if (ed.state.doc.textContent.trim() === '') return ''
            return ed.getMarkdown()
        },
        getQuotes: () => (editorRef.current ? collectQuotesFromDoc(editorRef.current.state.doc) : []),
        addQuote: (quote) => (editorRef.current ? addQuoteToEditor(editorRef.current, quote) : null),
        updateQuoteComment: (uid, comment) => (
            editorRef.current ? updateQuoteCommentInEditor(editorRef.current, uid, comment) : false
        ),
        insertQuotesAtEnd: (quotes) => {
            if (editorRef.current) insertQuotesAtEnd(editorRef.current, quotes)
        },
        getEditor: () => editorRef.current,
        clear: () => setText(''),
    }), [])

    // disabled 切换：setEditable 程序性切换（emitUpdate=false——v3 无条件 emit update，
    // MarkdownEditorView 的同款守卫：同值跳过 + 第二参 false）
    useEffect(() => {
        const ed = editorRef.current
        if (!ed) return
        if (!!ed.isEditable === !disabled) return
        ed.setEditable(!disabled, false)
    }, [editor, disabled])

    const shellStyle = {
        ...style,
        '--chat-input-min-h': `${minRows * LINE_HEIGHT_PX}px`,
        '--chat-input-max-h': `${maxRows * LINE_HEIGHT_PX}px`,
    } as CSSProperties

    return (
        <div
            className={className ? `chat-input ${className}` : 'chat-input'}
            style={shellStyle}
            aria-disabled={disabled || undefined}
        >
            <EditorContent editor={editor} />
        </div>
    )
}
