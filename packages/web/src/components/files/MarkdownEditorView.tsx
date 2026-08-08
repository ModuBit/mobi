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

import { useEffect, useRef, useState, type ComponentType, type CSSProperties } from 'react'
import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import { Button, Popover, Tooltip, Input, theme as antTheme } from 'antd'
import { Bold, Italic, Strikethrough, Code, Link as LinkIcon, Link2, Check, ExternalLink, Unlink } from 'lucide-react'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { CodeBlockWithMermaid } from './CodeBlockMermaid'
import Link from '@tiptap/extension-link'
import { linkInputRule } from './linkInputRule'

// Link 扩展 + 输入规则：打字 [text](url) 自动转链接（@tiptap/markdown 不提供打字解析）
const LinkWithInputRule = Link.extend({
    addInputRules() {
        return [linkInputRule()]
    },
})
import Image from '@tiptap/extension-image'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { InputRule } from '@tiptap/core'

// TaskList + 自定义 input rule：输入 [] / [ ] / [x] + 空格 → 转 task item
// （避开 StarterKit ListItem 的 "- " input rule 抢占——markdown 的 "- [ ]" 永远到不了）
const TaskListWithInput = TaskList.extend({
    addInputRules() {
        return [
            ...(this.parent?.() ?? []),
            new InputRule({
                find: /^\s*\[([ xX])\]\s$/,
                handler: ({ match, range, chain }) => {
                    const checked = match[1].toLowerCase() === 'x'
                    chain()
                        .deleteRange({ from: range.from, to: range.to })
                        .toggleTaskList()
                        .run()
                    if (checked) {
                        // toggleTaskList 默认 unchecked；[x] 标记完成（当前 taskItem）
                        chain().updateAttributes('taskItem', { checked: true }).run()
                    }
                },
            }),
        ]
    },
})
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
            LinkWithInputRule.configure({ autolink: true, linkOnPaste: true, openOnClick: false }),
            Image.configure({ inline: false, allowBase64: true }),
            Table.configure({ resizable: false, lastColumnResizable: false }),
            TableRow,
            TableCell,
            TableHeader,
            TaskListWithInput,
            TaskItem.configure({ nested: true }),
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
                <>
                    {/* 格式 menu：选中文本（非空选区）时显示 */}
                    <BubbleMenu
                        editor={editor}
                        pluginKey="formatMenu"
                        appendTo={() => document.body}
                        shouldShow={({ state }: { state: { selection: { empty: boolean } } }) => !state.selection.empty}
                    >
                        <MdBubbleContent editor={editor} />
                    </BubbleMenu>
                    {/* 链接 menu：光标定位链接（collapsed 选区 + 在 link 内）时显示 */}
                    <BubbleMenu
                        editor={editor}
                        pluginKey="linkMenu"
                        appendTo={() => document.body}
                        shouldShow={({ editor, state }: { editor: Editor; state: { selection: { empty: boolean } } }) => state.selection.empty && editor.isActive('link')}
                    >
                        <LinkBubble editor={editor} />
                    </BubbleMenu>
                </>
            )}
        </div>
    )
}

interface IconProps { size?: number }

/** BubbleMenu 内容：选中文本的格式浮窗（加粗/斜体/.../加链接） */
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

/** 链接态 bubble：单行 URL + apply / open / remove（全 icon；标题在编辑器内直接改） */
function LinkBubble({ editor }: { editor: Editor }) {
    const { token } = antTheme.useToken()
    const [url, setUrl] = useState((editor.getAttributes('link').href as string | undefined) ?? '')
    // BubbleMenu children 常驻（不每次 remount），需主动同步当前 link 的 href 到 input
    const lastHrefRef = useRef<string | null>(null)
    useEffect(() => {
        const update = () => {
            if (editor.isActive('link')) {
                const h = (editor.getAttributes('link').href as string | undefined) ?? ''
                // 仅在 link href 真正变化时回填，避免覆盖用户正在输入的值
                if (h !== lastHrefRef.current) {
                    lastHrefRef.current = h
                    setUrl(h)
                }
            } else {
                lastHrefRef.current = null
            }
        }
        editor.on('selectionUpdate', update)
        editor.on('transaction', update)
        return () => {
            editor.off('selectionUpdate', update)
            editor.off('transaction', update)
        }
    }, [editor])

    const apply = () => {
        const href = url.trim()
        if (!href) {
            editor.chain().focus().extendMarkRange('link').unsetLink().run()
            return
        }
        editor.chain().focus().extendMarkRange('link').setLink({ href }).run()
    }
    const remove = () => editor.chain().focus().extendMarkRange('link').unsetLink().run()
    const visit = () => {
        const h = url.trim()
        if (h) window.open(h, '_blank', 'noopener,noreferrer')
    }

    // DESIGN：抬升层净白底 + 圆角 lg + 极淡边框 + 极淡投影（rgba 0.05），零粗阴影
    const card: CSSProperties = {
        display: 'flex', alignItems: 'center', gap: 4,
        background: token.colorBgElevated,
        borderRadius: token.borderRadiusLG,
        border: `1px solid ${token.colorBorderSecondary}`,
        boxShadow: 'rgba(0,0,0,0.05) 0px 4px 24px',
        padding: 4,
    }

    return (
        <div style={card}>
            <Input
                className="md-link-input"
                variant="borderless"
                size="small"
                prefix={<Link2 size={13} style={{ color: token.colorTextTertiary }} />}
                placeholder="https://"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onPressEnter={apply}
                autoFocus
                style={{ flex: 1, width: 220, fontSize: 12, fontFamily: 'var(--font-mono, JetBrains Mono, monospace)' }}
            />
            <Tooltip title="应用链接" mouseEnterDelay={0.4}>
                <Button type="text" size="small" icon={<Check size={15} style={{ color: token.colorPrimary }} />} onClick={apply} />
            </Tooltip>
            <Tooltip title="新窗口打开" mouseEnterDelay={0.4}>
                <Button type="text" size="small" icon={<ExternalLink size={15} />} onClick={visit} />
            </Tooltip>
            <Tooltip title="移除链接" mouseEnterDelay={0.4}>
                <Button type="text" size="small" danger icon={<Unlink size={15} />} onClick={remove} />
            </Tooltip>
        </div>
    )
}
