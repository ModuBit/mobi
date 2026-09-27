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
 * 单文件 diff 渲染（票05/票01 spike 结论 go）：@codemirror/merge readonly unified——
 * before 全文作 original，after 全文作 doc，天然虚拟化（.cm-line 恒定）+ collapseUnchanged
 * 折叠大段未变更区。主题走 --ant-* CSS 变量零 reconfigure（light/dark 切换自动跟随）。
 * patch 字段仅统计/降级用，本组件不渲染 patch。
 */

import { useEffect, useRef } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { unifiedMergeView } from '@codemirror/merge'
import { useTranslation } from 'react-i18next'

/** antd token → codemirror 颜色桥接（双主题各自有值，direction 由 antd 保证） */
const diffTheme = EditorView.theme({
    '&': {
        color: 'var(--ant-color-text)',
        backgroundColor: 'transparent',
        fontSize: '12px',
    },
    '.cm-content': { fontFamily: 'var(--font-mono, monospace)', paddingBottom: '12px' },
    '.cm-gutters': {
        backgroundColor: 'var(--ant-color-fill-quaternary)',
        color: 'var(--ant-color-text-tertiary)',
        border: 'none',
    },
    '.cm-activeLine': { backgroundColor: 'transparent' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent' },
    // 变更行（增/改）与被删块：语义色背景，hover 档词级高亮
    '.cm-changedLine': { backgroundColor: 'var(--ant-color-success-bg)' },
    '.cm-deletedChunk': { backgroundColor: 'var(--ant-color-error-bg)' },
    '.cm-changedText': { backgroundColor: 'var(--ant-color-success-bg-hover)' },
    '.cm-deletedText': { backgroundColor: 'var(--ant-color-error-bg-hover)' },
    // 折叠条（collapseUnchanged）：弱化呈现，点击展开
    '.cm-collapsedLines': {
        color: 'var(--ant-color-text-tertiary)',
        backgroundColor: 'var(--ant-color-fill-tertiary)',
        border: 'none',
        padding: '2px 12px',
    },
})

export function DiffViewer({ before, after }: { before: string; after: string }) {
    const { t } = useTranslation()
    const hostRef = useRef<HTMLDivElement | null>(null)

    useEffect(() => {
        const host = hostRef.current
        if (!host) return

        const view = new EditorView({
            state: EditorState.create({
                doc: after,
                extensions: [
                    diffTheme,
                    EditorView.lineWrapping,
                    // 只读双 extension：state 层禁止事务 + view 层不可编辑（spike 结论）
                    EditorState.readOnly.of(true),
                    EditorView.editable.of(false),
                    unifiedMergeView({
                        original: before,
                        highlightChanges: true,
                        mergeControls: false,
                        collapseUnchanged: { minSize: 5, margin: 3 },
                    }),
                ],
            }),
            parent: host,
        })
        return () => view.destroy()
    }, [before, after])

    return (
        <div
            data-testid="git-diff-viewer"
            aria-label={t('review.diffAria')}
            style={{ height: '100%', overflow: 'auto', minHeight: 0 }}
            ref={hostRef}
        />
    )
}
