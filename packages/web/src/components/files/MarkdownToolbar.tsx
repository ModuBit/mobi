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

import { useState, useEffect, useRef, type ComponentType, type CSSProperties } from 'react'
import { Button, Divider, Tooltip } from 'antd'
import { type Editor, useEditorState } from '@tiptap/react'
import {
    Bold, Italic, Strikethrough, Code, Heading1, Heading2, Heading3,
    List, ListOrdered, ListChecks, Quote, Code2, Minus,
    Table, Undo2, Redo2, ChevronLeft, ChevronRight,
    BetweenHorizontalEnd, BetweenHorizontalStart, BetweenVerticalEnd, BetweenVerticalStart, Grid2x2X,
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

// active 按钮样式：背景填充 colorPrimaryBg + primary 文字色表达（纸感美学靠明度差体现层次）。
// 仅靠 color:primary 在浅色主题下不可见（primary=深灰≈正文色）。
const activeBtnStyle: CSSProperties = {
    color: 'var(--ant-color-primary)',
    background: 'var(--ant-color-primary-bg)',
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
                style={active ? activeBtnStyle : undefined}
            />
        </Tooltip>
    )
}

interface Props {
    editor: Editor
}

/**
 * Markdown 编辑器顶部工具栏：格式 + 表格操作 + 历史。
 * 链接/图片通过 markdown 语法直接输入（[text](url) / ![alt](url)），不在工具栏设按钮。
 * 表格操作仅在光标位于表格内时显示。
 */
export function MarkdownToolbar({ editor }: Props) {
    const { t } = useTranslation()

    // 订阅 editor 状态：光标/选区变化时重算 active 与 can()，驱动按钮高亮。
    // useEditorState 对 selector 返回值做浅比较，仅在相关字段变化时重渲染（性能优于 forceUpdate）。
    const active = useEditorState({
        editor,
        selector: ({ editor }) => ({
            h1: editor.isActive('heading', { level: 1 }),
            h2: editor.isActive('heading', { level: 2 }),
            h3: editor.isActive('heading', { level: 3 }),
            bold: editor.isActive('bold'),
            italic: editor.isActive('italic'),
            strike: editor.isActive('strike'),
            code: editor.isActive('code'),
            bullet: editor.isActive('bulletList'),
            ordered: editor.isActive('orderedList'),
            todo: editor.isActive('taskList'),
            quote: editor.isActive('blockquote'),
            codeBlock: editor.isActive('codeBlock'),
            inTable: editor.isActive('table'),
            canUndo: editor.can().undo(),
            canRedo: editor.can().redo(),
        }),
    })

    // 工具栏横向滚动：内容超出时左右滑动，箭头提示且可点击滑动，隐藏原生滚动条
    const scrollRef = useRef<HTMLDivElement>(null)
    const [canLeft, setCanLeft] = useState(false)
    const [canRight, setCanRight] = useState(false)
    const updateScroll = () => {
        const el = scrollRef.current
        if (!el) return
        setCanLeft(el.scrollLeft > 2)
        setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2)
    }
    useEffect(() => {
        const el = scrollRef.current
        if (!el) return
        updateScroll()
        el.addEventListener('scroll', updateScroll, { passive: true })
        // 内容增减（如 inTable 时表格按钮出现/消失）或容器尺寸变化时重算
        const ro = new ResizeObserver(updateScroll)
        ro.observe(el)
        return () => {
            el.removeEventListener('scroll', updateScroll)
            ro.disconnect()
        }
    }, [])
    const scrollBy = (dir: 1 | -1) => {
        const el = scrollRef.current
        if (!el) return
        el.scrollBy({ left: dir * el.clientWidth * 0.7, behavior: 'smooth' })
    }

    const inTable = active.inTable
    const tr = (k: string, fb: string) => t(`files.toolbar.${k}`, fb)

    return (
        <div
            className="md-toolbar-wrap"
            style={{
                position: 'relative',
                borderBottom: '1px solid var(--ant-color-border-secondary)',
                flexShrink: 0,
            }}
        >
            {canLeft && (
                <button
                    type="button"
                    className="md-toolbar-arrow md-toolbar-arrow-left"
                    aria-label="向左滑动"
                    onClick={() => scrollBy(-1)}
                >
                    <ChevronLeft size={16} />
                </button>
            )}
            <div
                ref={scrollRef}
                className="md-toolbar-scroll"
                style={{
                    display: 'flex', alignItems: 'center', gap: 2, padding: '2px 6px',
                    overflowX: 'auto', overflowY: 'hidden',
                }}
            >
            <ToolBtn icon={Heading1} title={tr('h1', '标题1')} active={active.h1} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} />
            <ToolBtn icon={Heading2} title={tr('h2', '标题2')} active={active.h2} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} />
            <ToolBtn icon={Heading3} title={tr('h3', '标题3')} active={active.h3} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} />
            <Divider type="vertical" style={{ margin: '0 2px' }} />
            <ToolBtn icon={Bold} title={tr('bold', '加粗')} active={active.bold} onClick={() => editor.chain().focus().toggleBold().run()} />
            <ToolBtn icon={Italic} title={tr('italic', '斜体')} active={active.italic} onClick={() => editor.chain().focus().toggleItalic().run()} />
            <ToolBtn icon={Strikethrough} title={tr('strike', '删除线')} active={active.strike} onClick={() => editor.chain().focus().toggleStrike().run()} />
            <ToolBtn icon={Code} title={tr('code', '行内代码')} active={active.code} onClick={() => editor.chain().focus().toggleCode().run()} />
            <Divider type="vertical" style={{ margin: '0 2px' }} />
            <ToolBtn icon={List} title={tr('bullet', '无序列表')} active={active.bullet} onClick={() => editor.chain().focus().toggleBulletList().run()} />
            <ToolBtn icon={ListOrdered} title={tr('ordered', '有序列表')} active={active.ordered} onClick={() => editor.chain().focus().toggleOrderedList().run()} />
            <ToolBtn icon={ListChecks} title={tr('todo', '待办列表')} active={active.todo} onClick={() => editor.chain().focus().toggleTaskList().run()} />
            <ToolBtn icon={Quote} title={tr('quote', '引用')} active={active.quote} onClick={() => editor.chain().focus().toggleBlockquote().run()} />
            <ToolBtn icon={Code2} title={tr('codeBlock', '代码块')} active={active.codeBlock} onClick={() => editor.chain().focus().setCodeBlock().run()} />
            <ToolBtn icon={Minus} title={tr('hr', '分割线')} onClick={() => editor.chain().focus().setHorizontalRule().run()} />
            <Divider type="vertical" style={{ margin: '0 2px' }} />
            <ToolBtn icon={Table} title={tr('table', '插入表格')} onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} />
            {inTable && (
                <>
                    <ToolBtn icon={BetweenHorizontalEnd} title={tr('addRow', '加行（下方）')} onClick={() => editor.chain().focus().addRowAfter().run()} />
                    <ToolBtn icon={BetweenHorizontalStart} title={tr('delRow', '删行')} onClick={() => editor.chain().focus().deleteRow().run()} />
                    <ToolBtn icon={BetweenVerticalEnd} title={tr('addColumn', '加列（右侧）')} onClick={() => editor.chain().focus().addColumnAfter().run()} />
                    <ToolBtn icon={BetweenVerticalStart} title={tr('delColumn', '删列')} onClick={() => editor.chain().focus().deleteColumn().run()} />
                    <ToolBtn icon={Grid2x2X} title={tr('delTable', '删表格')} onClick={() => editor.chain().focus().deleteTable().run()} />
                </>
            )}
            <Divider type="vertical" style={{ margin: '0 2px' }} />
            <ToolBtn icon={Undo2} title={tr('undo', '撤销')} onClick={() => editor.chain().focus().undo().run()} disabled={!active.canUndo} />
            <ToolBtn icon={Redo2} title={tr('redo', '重做')} onClick={() => editor.chain().focus().redo().run()} disabled={!active.canRedo} />
            </div>
            {canRight && (
                <button
                    type="button"
                    className="md-toolbar-arrow md-toolbar-arrow-right"
                    aria-label="向右滑动"
                    onClick={() => scrollBy(1)}
                >
                    <ChevronRight size={16} />
                </button>
            )}
        </div>
    )
}
