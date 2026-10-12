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
import { EditorState, Compartment, type Extension } from '@codemirror/state'
import { EditorView, lineNumbers, highlightActiveLine, keymap } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language'
import { oneDarkHighlightStyle } from '@codemirror/theme-one-dark'
import { useUiStore, resolveTheme } from '@/core/data/stores/uiStore'
import './editor.css'
/** 按扩展名异步加载 CodeMirror 语言包（未匹配则返回 null，纯文本无高亮） */
async function langFor(filePath: string): Promise<Extension | null> {
    const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
    switch (ext) {
        case 'ts': case 'tsx':
            return (await import('@codemirror/lang-javascript')).javascript({ jsx: ext === 'tsx', typescript: true })
        case 'js': case 'jsx': case 'mjs': case 'cjs':
            return (await import('@codemirror/lang-javascript')).javascript({ jsx: ext === 'jsx' })
        case 'json':
            return (await import('@codemirror/lang-json')).json()
        case 'css': case 'scss': case 'less':
            return (await import('@codemirror/lang-css')).css()
        case 'py':
            return (await import('@codemirror/lang-python')).python()
        case 'md': case 'markdown':
            return (await import('@codemirror/lang-markdown')).markdown()
        default:
            return null
    }
}

interface Props {
    text: string
    filePath: string
    wrap: boolean
    /** 只读态：不可输入但渲染效果与编辑态完全一致（离线查看 / 无写权限文件） */
    readOnly?: boolean
    onChange: (text: string) => void
}

/**
 * 代码/文本编辑器（CodeMirror 6）。
 *
 * - filePath 维度重建 editor（切文件另起一个 CodeMirror 实例）
 * - 语言包按需动态 import，首屏不加载全部
 * - wrap / 主题（深浅）/ readOnly 通过 Compartment 动态 reconfigure，不重建 editor
 * - 外部 text 变化（OCC reload）→ dispatch changes 同步，仅当与当前内容不同
 * - onChange 用 ref 持有，避免 docChanged 触发时闭包 stale
 */
export function CodeEditorView({ text, filePath, wrap, readOnly = false, onChange }: Props) {
    const host = useRef<HTMLDivElement>(null)
    const view = useRef<EditorView | null>(null)
    const langComp = useRef(new Compartment())
    const wrapComp = useRef(new Compartment())
    const themeComp = useRef(new Compartment())
    const readComp = useRef(new Compartment())
    const isDark = useUiStore((s) => resolveTheme(s.theme) === 'dark')

    // onChange 用 ref，避免 docChanged 闭包 stale + 避免 editor 重建
    const onChangeRef = useRef(onChange)
    onChangeRef.current = onChange
    // 外部 text 同步（dispatch）期间置 true，阻断 updateListener 回灌 onChange 致循环
    const syncingRef = useRef(false)

    // 创建 editor（仅 filePath 维度重建）
    useEffect(() => {
        if (!host.current) return
        const extensions = [
            lineNumbers(),
            highlightActiveLine(),
            history(),
            keymap.of([...defaultKeymap, ...historyKeymap]),
            systemChrome,
            langComp.current.of([]),
            wrapComp.current.of(wrap ? EditorView.lineWrapping : []),
            themeComp.current.of(highlightFor(isDark)),
            readComp.current.of(readOnlyExtensions(readOnly)),
            EditorView.updateListener.of((u) => {
                if (u.docChanged && !syncingRef.current) onChangeRef.current(u.state.doc.toString())
            }),
        ]
        view.current = new EditorView({
            state: EditorState.create({ doc: text, extensions }),
            parent: host.current,
        })
        // 异步加载语言包（reconfigure，不重建 editor）
        void langFor(filePath).then((lang) => {
            if (view.current && lang) {
                view.current.dispatch({ effects: langComp.current.reconfigure(lang) })
            }
        })
        return () => {
            view.current?.destroy()
            view.current = null
        }
        // 仅 filePath 变化重建；text/wrap/isDark/readOnly 用闭包初值，由下方专门 effect 同步
    }, [filePath])

    // 外部 text 变化 → 同步（仅当与当前 doc 不同，避免光标/历史重置）
    useEffect(() => {
        if (view.current && view.current.state.doc.toString() !== text) {
            // dispatch 期间置 syncingRef，避免 updateListener 回灌 onChange → editor.update → 循环
            syncingRef.current = true
            view.current.dispatch({
                changes: { from: 0, to: view.current.state.doc.length, insert: text },
            })
            syncingRef.current = false
        }
    }, [text])

    // wrap 切换
    useEffect(() => {
        view.current?.dispatch({
            effects: wrapComp.current.reconfigure(wrap ? EditorView.lineWrapping : []),
        })
    }, [wrap])

    // 语法高亮切换（容器 chrome 走 --ant-* 变量自动跟随主题，无需 reconfigure）
    useEffect(() => {
        view.current?.dispatch({
            effects: themeComp.current.reconfigure(highlightFor(isDark)),
        })
    }, [isDark])

    // 只读切换
    useEffect(() => {
        view.current?.dispatch({
            effects: readComp.current.reconfigure(readOnlyExtensions(readOnly)),
        })
    }, [readOnly])

    return <div ref={host} className="code-editor-view" style={{ height: '100%' }} />
}

/** CodeMirror 只读双 extension：readOnly 挡命令，editable=false 移除可编辑光标 */
function readOnlyExtensions(readOnly: boolean): Extension[] {
    return readOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : []
}

/**
 * 容器 chrome 主题：底色/行号/当前行/选区/光标走 --ant-* 变量归入暖纸体系
 * （此前直接用 oneDark 整包，其蓝灰底 #282c34 与全站色温割裂，见走查报告 A6）。
 * 变量随主题切换自动生效，无需 reconfigure；语法高亮不在此——见下方 highlightFor。
 */
const systemChrome = EditorView.theme({
    '&': {
        backgroundColor: 'var(--ant-color-bg-container, #faf9f5)',
        color: 'var(--ant-color-text)',
    },
    '.cm-gutters': {
        backgroundColor: 'var(--ant-color-bg-layout, #f0eee6)',
        color: 'var(--ant-color-text-quaternary)',
        borderRight: '1px solid var(--ant-color-border-secondary, rgba(0, 0, 0, 0.06))',
    },
    '.cm-activeLine': {
        backgroundColor: 'var(--ant-color-fill-quaternary)',
    },
    '.cm-activeLineGutter': {
        backgroundColor: 'var(--ant-color-fill-quaternary)',
        color: 'var(--ant-color-text-secondary)',
    },
    // CodeMirror 官方约定：selection 类样式需 !important 才能盖过内置 selection 高亮
    '.cm-selectionBackground': {
        backgroundColor: 'var(--ant-color-fill-secondary) !important',
    },
    '&.cm-focused .cm-selectionBackground': {
        backgroundColor: 'var(--ant-color-fill-secondary) !important',
    },
    '.cm-cursor': {
        borderLeftColor: 'var(--ant-color-text)',
    },
})

/** 语法高亮（与容器 chrome 拆开）：dark 沿用 One Dark 色板，light 用默认高亮（与现状一致） */
function highlightFor(isDark: boolean): Extension {
    return isDark
        ? syntaxHighlighting(oneDarkHighlightStyle)
        : syntaxHighlighting(defaultHighlightStyle, { fallback: true })
}
