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

import { useEffect, useImperativeHandle, useRef, type CSSProperties, type Ref } from 'react'
import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { TextSelection } from '@tiptap/pm/state'
import type { Node as PMNode } from '@tiptap/pm/model'
import { getTextBetween, getTextSerializersFromSchema, type AnyExtension, type JSONContent } from '@tiptap/core'
import { isComposingEvent } from '@/core/lib/inputEnterKeys'
import './chat-input.css'

/** 行高常量：对齐现 Sender 输入区视觉（14px 字号 / 22px 行高），min/max 行数 → 像素换算 */
const LINE_HEIGHT_PX = 22

/** 程序化写入 meta 标记：区分 setText/setEditorStateJSON 等程序写入与用户输入（防 onUpdate 回环误消费） */
const PROGRAMMATIC_META = 'chat-input-programmatic'

/** doc 中装配节点的实例数（quoteCount 派生源；未装节点恒 0） */
function countExtraNodes(doc: PMNode, extraNodes: AnyExtension[] | undefined): number {
    if (!extraNodes?.length) return 0
    const names = new Set(extraNodes.map((n) => n.name))
    let count = 0
    doc.descendants((node) => {
        if (names.has(node.type.name)) count++
        return true
    })
    return count
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
    onUpdate?: (ctx: { text: string; programmatic: boolean; cursorOffset: number; quoteCount: number; editorStateJSON: string }) => void
    onFocus?: () => void
    onBlur?: () => void
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
    blur(): void
    /** 纯文本（段落分隔符统一 '\n'，与 textarea 语义一致） */
    getText(): string
    getEditorStateJSON(): string
    /** 程序化整体替换（三原则：meta 标记 + addToHistory:false + 光标置尾） */
    setText(text: string): void
    /** 解析失败静默降级为 no-op（调用方自己兜底 setText） */
    setEditorStateJSON(json: string): void
    /** 在当前光标处插入纯文本，光标落插入内容之后 */
    insertAtCursor(text: string): void
    /** 把光标移到纯文本 offset 处（与 onUpdate ctx.cursorOffset 同语义；越界/空文档置尾） */
    setCursorOffset(offset: number): void
    /** 编辑器实例逃生舱（业务方做节点级操作：引用 chip 的增删改遍历等）；未就绪返回 null */
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
    minRows = 1,
    maxRows = 5,
    submitKey = 'enter',
    onSubmit,
    onKeyDown,
    onUpdate,
    onFocus,
    onBlur,
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
    const propsRef = useRef({ onSubmit, onKeyDown, onUpdate, onFocus, onBlur, onPaste, placeholder, submitKey })
    propsRef.current = { onSubmit, onKeyDown, onUpdate, onFocus, onBlur, onPaste, placeholder, submitKey }
    const onReadyRef = useRef(onReady)
    onReadyRef.current = onReady

    // editor 实例 ref：editorProps 回调在 options 求值时创建，闭包捕获不到后续就绪的 editor——经 ref 读取
    const editorRef = useRef<Editor | null>(null)

    const editor = useEditor({
        // SSR/水合安全（MarkdownEditorView 同款）：首帧不渲染编辑器，挂载后异步就绪
        immediatelyRender: false,
        injectCSS: false,
        // editable 初始态；运行时切换由下方 effect 走 setEditable（不重建 editor）
        editable: !disabled,
        // 输入区无富文本格式需求，StarterKit 逐项关闭（体积与语义双收），只留
        // document / paragraph / text / undoRedo；hardBreak 关闭 = 换行一律 splitBlock，
        // getText 段落语义单源（Shift+Enter 换行在键位层主动 splitBlock）
        extensions: [
            StarterKit.configure({
                bold: false, italic: false, strike: false, code: false, codeBlock: false,
                blockquote: false, bulletList: false, orderedList: false, listItem: false,
                horizontalRule: false, heading: false, hardBreak: false,
                dropcursor: false, gapcursor: false, // undoRedo 保持默认启用（v3 options 只接受 false|配置对象，开=省略）
            }),
            // 函数形式读 ref：动态文案（bash 模式占位切换）不重建 editor
            Placeholder.configure({
                placeholder: () => propsRef.current.placeholder ?? '',
            }),
            // 装配注入的业务节点（引用 chip 等）：ui 层零业务，节点实现由消费方提供
            ...(extraNodes ?? []),
        ],
        editorProps: {
            attributes: {
                role: 'textbox',
                'aria-multiline': 'true',
                spellcheck: 'false',
                ...(ariaLabel ? { 'aria-label': ariaLabel } : {}),
            },
            handleKeyDown: (_view, event) => handleKeyDown(event),
            handlePaste: (_view, event) => {
                const handler = propsRef.current.onPaste
                return handler ? handler(event) === true : false
            },
            // v3 无 handleFocus/handleBlur 命名槽，走 handleDOMEvents（返回 false 不消费，默认行为继续）
            handleDOMEvents: {
                focus: () => { propsRef.current.onFocus?.(); return false },
                blur: () => { propsRef.current.onBlur?.(); return false },
            },
        },
        onUpdate: ({ editor, transaction }) => {
            // offset/降级文本同源：getTextBetween 吃 schema 的 toText 序列化器
            // （节点 renderText 落 schema.toText）——chip 的「excerpt」在 getText 与
            // cursorOffset 两侧一致，面板检测的 cursorPos 不错位
            const serializers = getTextSerializersFromSchema(editor.schema)
            propsRef.current.onUpdate?.({
                text: editor.getText({ blockSeparator: '\n' }),
                programmatic: transaction.getMeta(PROGRAMMATIC_META) === true,
                cursorOffset: getTextBetween(editor.state.doc, { from: 0, to: editor.state.selection.from }, {
                    blockSeparator: '\n',
                    textSerializers: serializers,
                }).length,
                quoteCount: countExtraNodes(editor.state.doc, extraNodes),
                editorStateJSON: JSON.stringify(editor.getJSON()),
            })
        },
        // 先把实例交给 ref 再通知就绪：onCreate 在 useEditor 的创建路径内同步触发，
        // 早于组件下一次渲染对 editorRef 的赋值——否则 onReady 里的 handle 调用全是 no-op
        onCreate: ({ editor }) => { editorRef.current = editor; onReadyRef.current?.() },
    })
    // 每渲染同步（挂载后 editor 由 null → 实例触发重渲染，ref 随之就位）
    editorRef.current = editor

    /**
     * 键位层（顺序固定）：消费方接管 → IME 守卫 → Enter 判定（语义抄 antx TextArea.js：
     * 修饰键不放行、submitKey 分流）。换行不自己造命令形态——裸 Enter 放行给 TipTap
     * 默认 splitBlock；shift+Enter 因 hardBreak 关闭无默认绑定，主动 splitBlock 保持
     * getText 段落语义单源。
     */
    const handleKeyDown = (event: KeyboardEvent): boolean => {
        // 1. 消费方接管（面板导航/快捷键等）
        if (propsRef.current.onKeyDown?.(event) === true) return true
        // 2. IME 组合残留：isComposing + keyCode 229 兜底，放行给编辑器
        if (isComposingEvent({ nativeEvent: event })) return false
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
        // 5. 换行路径：裸 Enter 放行（TipTap 默认 splitBlock）；shift+Enter 主动 splitBlock
        if (event.shiftKey) {
            event.preventDefault()
            editorRef.current?.commands.splitBlock()
            return true
        }
        return false
    }

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
    const setText = (text: string) => {
        const ed = editorRef.current
        if (!ed) return
        ed.chain()
            .command(({ tr }) => {
                tr.setMeta(PROGRAMMATIC_META, true)
                tr.setMeta('addToHistory', false)
                return true
            })
            .setContent(buildTextDoc(text), { emitUpdate: true })
            .command(({ tr }) => {
                tr.setSelection(TextSelection.atEnd(tr.doc))
                return true
            })
            .run()
    }

    const setEditorStateJSON = (json: string) => {
        const ed = editorRef.current
        if (!ed) return
        let parsed: JSONContent
        try {
            parsed = JSON.parse(json) as JSONContent
        } catch {
            return // 非法 JSON 静默降级为 no-op（调用方自己兜底 setText）
        }
        ed.chain()
            .command(({ tr }) => {
                tr.setMeta(PROGRAMMATIC_META, true)
                tr.setMeta('addToHistory', false)
                return true
            })
            .setContent(parsed, { emitUpdate: true })
            .command(({ tr }) => {
                tr.setSelection(TextSelection.atEnd(tr.doc))
                return true
            })
            .run()
    }

    // Handle 全走 editorRef 读取（deps 留空，方法体无闭包过期风险）
    useImperativeHandle(ref, () => ({
        focus: (options?: { preventScroll?: boolean }) => {
            // 直接 DOM focus 透传 preventScroll（发送后恢复焦点的滚动抑制）——
            // TipTap focus() 的 options 只有 scrollIntoView，不收 preventScroll；
            // PM 光标 selection 独立于 DOM 焦点，重新聚焦后光标原地保持
            editorRef.current?.view.dom.focus({ preventScroll: options?.preventScroll })
        },
        blur: () => editorRef.current?.commands.blur(),
        getText: () => editorRef.current?.getText({ blockSeparator: '\n' }) ?? '',
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
            const serializers = getTextSerializersFromSchema(ed.schema)
            const textBefore = (pos: number) => getTextBetween(doc, { from: 0, to: pos }, {
                blockSeparator: '\n',
                textSerializers: serializers,
            }).length
            let target: number | null = null
            doc.descendants((node, pos) => {
                if (target != null || !node.isText) return true
                const before = textBefore(pos)
                if (before + node.nodeSize >= offset) {
                    target = pos + (offset - before)
                    return false
                }
                return true
            })
            ed.commands.setTextSelection(target ?? TextSelection.atEnd(doc).from)
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
