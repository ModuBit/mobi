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

import { useEffect, useRef, useState, type ComponentType } from 'react'
import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import { Button, Popover, Tooltip, Input } from 'antd'
import { Bold, Italic, Strikethrough, Code, Link as LinkIcon } from 'lucide-react'
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
import { MarkdownToolbar } from './MarkdownToolbar'
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
 * - 顶部 MarkdownToolbar（格式/插入/表格操作）+ BubbleMenu（选中浮窗：格式/链接编辑）
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
        <div className="markdown-editor-view" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            {editor && <MarkdownToolbar editor={editor} />}
            <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 16 }}>
                <EditorContent editor={editor} />
            </div>
            {editor && (
                <BubbleMenu editor={editor} className="md-bubble" shouldShow={({ state }: { state: { selection: { empty: boolean } } }) => !state.selection.empty}>
                    <MdBubbleContent editor={editor} />
                </BubbleMenu>
            )}
        </div>
    )
}

interface IconProps { size?: number }

/** BubbleMenu 内容：选中浮窗（格式 + 链接编辑） */
function MdBubbleContent({ editor }: { editor: Editor }) {
    const [linkOpen, setLinkOpen] = useState(false)
    const [linkUrl, setLinkUrl] = useState('')

    const openLink = () => {
        setLinkUrl((editor.getAttributes('link').href as string | undefined) ?? '')
        setLinkOpen(true)
    }
    const applyLink = () => {
        const chain = editor.chain().focus().extendMarkRange('link')
        if (linkUrl.trim()) chain.setLink({ href: linkUrl.trim() }).run()
        else chain.unsetLink().run()
        setLinkOpen(false)
    }

    const Btn = ({ icon: Icon, title, onClick, active }: {
        icon: ComponentType<IconProps>; title: string; onClick: () => void; active?: boolean
    }) => (
        <Tooltip title={title}>
            <Button
                type="text"
                size="small"
                icon={<Icon size={14} />}
                onClick={onClick}
                style={active ? { color: 'var(--ant-color-primary, #4dabf7)' } : undefined}
            />
        </Tooltip>
    )

    return (
        <div style={{
            display: 'flex', alignItems: 'center', gap: 2, padding: '2px 4px',
            background: 'var(--ant-color-bg-elevated, #fff)',
            borderRadius: 6,
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        }}>
            <Btn icon={Bold} title="加粗" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} />
            <Btn icon={Italic} title="斜体" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} />
            <Btn icon={Strikethrough} title="删除线" active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()} />
            <Btn icon={Code} title="行内代码" active={editor.isActive('code')} onClick={() => editor.chain().focus().toggleCode().run()} />
            <Popover
                open={linkOpen}
                onOpenChange={setLinkOpen}
                trigger="click"
                placement="bottom"
                content={
                    <div style={{ display: 'flex', gap: 4 }}>
                        <Input
                            size="small"
                            placeholder="https://"
                            value={linkUrl}
                            onChange={(e) => setLinkUrl(e.target.value)}
                            onPressEnter={applyLink}
                            style={{ width: 200 }}
                            autoFocus
                        />
                        <Button size="small" type="primary" onClick={applyLink}>确定</Button>
                    </div>
                }
            >
                <Btn icon={LinkIcon} title="链接" active={editor.isActive('link')} onClick={openLink} />
            </Popover>
        </div>
    )
}
