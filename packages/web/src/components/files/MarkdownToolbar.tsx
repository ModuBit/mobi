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

import { useState, type ComponentType } from 'react'
import { Button, Divider, Input, Popover, Tooltip } from 'antd'
import type { Editor } from '@tiptap/react'
import {
    Bold, Italic, Strikethrough, Code, Heading1, Heading2, Heading3,
    List, ListOrdered, Quote, Code2, Minus, Link as LinkIcon, Image as ImageIcon,
    Table, Plus, Trash2, Undo2, Redo2,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface IconProps { size?: number }
type IconType = ComponentType<IconProps>

interface ToolBtnProps {
    icon: IconType
    title: string
    onClick: () => void
    active?: boolean
    disabled?: boolean
}

function ToolBtn({ icon: Icon, title, onClick, active, disabled }: ToolBtnProps) {
    return (
        <Tooltip title={title}>
            <Button
                type="text"
                size="small"
                disabled={disabled}
                onClick={onClick}
                icon={<Icon size={15} />}
                style={active ? { color: 'var(--ant-color-primary, #4dabf7)' } : undefined}
            />
        </Tooltip>
    )
}

interface Props {
    editor: Editor
}

/**
 * Markdown 编辑器顶部工具栏：格式 + 插入 + 表格操作 + 历史。
 * 链接/图片用 Popover 输入 URL；表格操作仅在光标位于表格内时显示。
 */
export function MarkdownToolbar({ editor }: Props) {
    const { t } = useTranslation()
    const [linkUrl, setLinkUrl] = useState('')
    const [linkOpen, setLinkOpen] = useState(false)
    const [imgUrl, setImgUrl] = useState('')
    const [imgOpen, setImgOpen] = useState(false)

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

    const openImg = () => { setImgUrl(''); setImgOpen(true) }
    const applyImg = () => {
        if (imgUrl.trim()) editor.chain().focus().setImage({ src: imgUrl.trim() }).run()
        setImgOpen(false)
    }

    const inTable = editor.isActive('table')
    const tr = (k: string, fb: string) => t(`files.toolbar.${k}`, fb)

    return (
        <div
            className="md-toolbar"
            style={{
                display: 'flex', alignItems: 'center', gap: 2, padding: '2px 6px',
                flexWrap: 'wrap',
                borderBottom: '1px solid var(--ant-color-border-secondary)',
                flexShrink: 0,
            }}
        >
            <ToolBtn icon={Heading1} title={tr('h1', '标题1')} active={editor.isActive('heading', { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} />
            <ToolBtn icon={Heading2} title={tr('h2', '标题2')} active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} />
            <ToolBtn icon={Heading3} title={tr('h3', '标题3')} active={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} />
            <Divider type="vertical" style={{ margin: '0 2px' }} />
            <ToolBtn icon={Bold} title={tr('bold', '加粗')} active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} />
            <ToolBtn icon={Italic} title={tr('italic', '斜体')} active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} />
            <ToolBtn icon={Strikethrough} title={tr('strike', '删除线')} active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()} />
            <ToolBtn icon={Code} title={tr('code', '行内代码')} active={editor.isActive('code')} onClick={() => editor.chain().focus().toggleCode().run()} />
            <Divider type="vertical" style={{ margin: '0 2px' }} />
            <ToolBtn icon={List} title={tr('bullet', '无序列表')} active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()} />
            <ToolBtn icon={ListOrdered} title={tr('ordered', '有序列表')} active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()} />
            <ToolBtn icon={Quote} title={tr('quote', '引用')} active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()} />
            <ToolBtn icon={Code2} title={tr('codeBlock', '代码块')} active={editor.isActive('codeBlock')} onClick={() => editor.chain().focus().setCodeBlock().run()} />
            <ToolBtn icon={Minus} title={tr('hr', '分割线')} onClick={() => editor.chain().focus().setHorizontalRule().run()} />
            <Divider type="vertical" style={{ margin: '0 2px' }} />
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
                            style={{ width: 220 }}
                            autoFocus
                        />
                        <Button size="small" type="primary" onClick={applyLink}>{tr('ok', '确定')}</Button>
                    </div>
                }
            >
                <ToolBtn icon={LinkIcon} title={tr('link', '链接')} active={editor.isActive('link')} onClick={openLink} />
            </Popover>
            <Popover
                open={imgOpen}
                onOpenChange={setImgOpen}
                trigger="click"
                placement="bottom"
                content={
                    <div style={{ display: 'flex', gap: 4 }}>
                        <Input
                            size="small"
                            placeholder="https://图片URL"
                            value={imgUrl}
                            onChange={(e) => setImgUrl(e.target.value)}
                            onPressEnter={applyImg}
                            style={{ width: 220 }}
                            autoFocus
                        />
                        <Button size="small" type="primary" onClick={applyImg}>{tr('ok', '确定')}</Button>
                    </div>
                }
            >
                <ToolBtn icon={ImageIcon} title={tr('image', '图片')} onClick={openImg} />
            </Popover>
            <Divider type="vertical" style={{ margin: '0 2px' }} />
            <ToolBtn icon={Table} title={tr('table', '插入表格')} onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} />
            {inTable && (
                <>
                    <ToolBtn icon={Plus} title={tr('addRow', '加行（下方）')} onClick={() => editor.chain().focus().addRowAfter().run()} />
                    <ToolBtn icon={Plus} title={tr('addColumn', '加列（右侧）')} onClick={() => editor.chain().focus().addColumnAfter().run()} />
                    <ToolBtn icon={Trash2} title={tr('delRow', '删行')} onClick={() => editor.chain().focus().deleteRow().run()} />
                    <ToolBtn icon={Trash2} title={tr('delColumn', '删列')} onClick={() => editor.chain().focus().deleteColumn().run()} />
                    <ToolBtn icon={Trash2} title={tr('delTable', '删表格')} onClick={() => editor.chain().focus().deleteTable().run()} />
                </>
            )}
            <Divider type="vertical" style={{ margin: '0 2px' }} />
            <ToolBtn icon={Undo2} title={tr('undo', '撤销')} onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} />
            <ToolBtn icon={Redo2} title={tr('redo', '重做')} onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} />
        </div>
    )
}
