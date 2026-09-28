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
 * before 全文作 original，after 全文作 doc，天然虚拟化（.cm-line 恒定）。patch 字段
 * 仅统计/降级用，本组件不渲染 patch。
 *
 * CM 机制拆在 ./codemirrorDiff/：theme（主题桥接）、chunkLineNumbers（双栏行号补齐）、
 * unchangedCollapse（未变更区折叠，含开关与交互禁用决策）。本文件只做装配。
 */

import { useEffect, useRef } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { unifiedMergeView } from '@codemirror/merge'
import { useTranslation } from 'react-i18next'
import { diffTheme } from './codemirrorDiff/theme'
import { createChunkLineNumbers, lineNumbers } from './codemirrorDiff/chunkLineNumbers'
import { createUnchangedCollapse } from './codemirrorDiff/unchangedCollapse'

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
                    // 行号 = 新文件（doc=after）行号；被删块是行间 widget，行号由
                    // createChunkLineNumbers 注入（旧行号，红标）
                    lineNumbers(),
                    createChunkLineNumbers(before),
                    // 只读双 extension：state 层禁止事务 + view 层不可编辑（spike 结论）
                    EditorState.readOnly.of(true),
                    EditorView.editable.of(false),
                    unifiedMergeView({
                        original: before,
                        highlightChanges: true,
                        mergeControls: false,
                        // 折叠由 createUnchangedCollapse 承担（原生单向展开无法折回）
                    }),
                    // 须在 unifiedMergeView 之后：create 时读取 chunk 字段（依赖初始化顺序）。
                    // 总开关内置在 createUnchangedCollapse 里（禁用时返回空数组）
                    ...createUnchangedCollapse(
                        (n) => t('review.unchangedLines', { n }),
                        t('review.collapseUnchanged'),
                    ),
                ],
            }),
            parent: host,
        })
        return () => {
            view.destroy()
        }
    }, [before, after, t])

    return (
        <div
            data-testid="git-diff-viewer"
            aria-label={t('review.diffAria')}
            style={{ flex: 1, minWidth: 0, height: '100%', overflow: 'auto', minHeight: 0 }}
            ref={hostRef}
        />
    )
}
