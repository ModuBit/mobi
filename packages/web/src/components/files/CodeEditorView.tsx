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
import { oneDark } from '@codemirror/theme-one-dark'
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
    onChange: (text: string) => void
}

/**
 * 代码/文本编辑器（CodeMirror 6）。
 *
 * - filePath 维度重建 editor（切文件另起一个 CodeMirror 实例）
 * - 语言包按需动态 import，首屏不加载全部
 * - wrap / 主题（深浅）通过 Compartment 动态 reconfigure，不重建 editor
 * - 外部 text 变化（OCC reload）→ dispatch changes 同步，仅当与当前内容不同
 * - onChange 用 ref 持有，避免 docChanged 触发时闭包 stale
 */
export function CodeEditorView({ text, filePath, wrap, onChange }: Props) {
    const host = useRef<HTMLDivElement>(null)
    const view = useRef<EditorView | null>(null)
    const langComp = useRef(new Compartment())
    const wrapComp = useRef(new Compartment())
    const themeComp = useRef(new Compartment())
    const isDark = useUiStore((s) => resolveTheme(s.theme) === 'dark')

    // onChange 用 ref，避免 docChanged 闭包 stale + 避免 editor 重建
    const onChangeRef = useRef(onChange)
    onChangeRef.current = onChange

    // 创建 editor（仅 filePath 维度重建）
    useEffect(() => {
        if (!host.current) return
        const extensions = [
            lineNumbers(),
            highlightActiveLine(),
            history(),
            keymap.of([...defaultKeymap, ...historyKeymap]),
            syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
            langComp.current.of([]),
            wrapComp.current.of(wrap ? EditorView.lineWrapping : []),
            themeComp.current.of(isDark ? oneDark : []),
            EditorView.updateListener.of((u) => {
                if (u.docChanged) onChangeRef.current(u.state.doc.toString())
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
        // 仅 filePath 变化重建；text/wrap/isDark 用闭包初值，由下方专门 effect 同步
    }, [filePath])

    // 外部 text 变化 → 同步（仅当与当前 doc 不同，避免光标/历史重置）
    useEffect(() => {
        if (view.current && view.current.state.doc.toString() !== text) {
            view.current.dispatch({
                changes: { from: 0, to: view.current.state.doc.length, insert: text },
            })
        }
    }, [text])

    // wrap 切换
    useEffect(() => {
        view.current?.dispatch({
            effects: wrapComp.current.reconfigure(wrap ? EditorView.lineWrapping : []),
        })
    }, [wrap])

    // 主题切换
    useEffect(() => {
        view.current?.dispatch({
            effects: themeComp.current.reconfigure(isDark ? oneDark : []),
        })
    }, [isDark])

    return <div ref={host} className="code-editor-view" style={{ height: '100%' }} />
}
