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

import { useEffect, useRef } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { CodeBlockWithMermaid } from './CodeBlockMermaid'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import { common, createLowlight } from 'lowlight'
import './editor.css'

// lowlight 模块级单例（common 常用语言；按需可补 all）
const lowlight = createLowlight(common)

interface Props {
    text: string
    onChange: (markdown: string) => void
}

/**
 * Typora 式 MD WYSIWYG 编辑器：渲染态即编辑态。
 *
 * - @tiptap/markdown 提供双向序列化：setContent(md, {contentType:'markdown'}) 解析、getMarkdown() 序列化
 * - onChange 用 ref 持有（避免 editor 重建）；外部 text 变化时用 syncingRef 守卫，
 *   避免 setContent 触发的 onUpdate 回灌导致循环（保存成功/重载场景）
 */
export function MarkdownEditorView({ text, onChange }: Props) {
    const onChangeRef = useRef(onChange)
    onChangeRef.current = onChange
    // 外部同步 text 时置 true，跳过 onUpdate 回灌，避免循环
    const syncingRef = useRef(false)

    const editor = useEditor({
        immediatelyRender: false,
        extensions: [
            // 禁用 StarterKit 默认 codeBlock（用 CodeBlockWithMermaid）+ link（用扩展版 autolink 配置）
            StarterKit.configure({ codeBlock: false, link: false }),
            CodeBlockWithMermaid.configure({ lowlight }),
            Link.configure({ autolink: true, linkOnPaste: true }),
            Image.configure({ inline: false, allowBase64: true }),
            Table.configure({ resizable: false, lastColumnResizable: false }),
            TableRow,
            TableCell,
            TableHeader,
            // markedOptions: gfm（表格/删除线）+ breaks（单换行→br，对齐 typora 式）
            Markdown.configure({ markedOptions: { gfm: true, breaks: true } }),
        ],
        content: text,
        onUpdate: ({ editor }) => {
            if (syncingRef.current) return
            onChangeRef.current(editor.getMarkdown())
        },
    })

    // 外部 text 变化（OCC reload / 文件切换后内容回填）→ 重新解析 markdown
    useEffect(() => {
        if (!editor) return
        if (editor.getMarkdown() !== text) {
            syncingRef.current = true
            editor.commands.setContent(text, { contentType: 'markdown' })
            syncingRef.current = false
        }
    }, [text, editor])

    return (
        <div className="markdown-editor-view" style={{ height: '100%', overflow: 'auto', padding: 16 }}>
            <EditorContent editor={editor} />
        </div>
    )
}
