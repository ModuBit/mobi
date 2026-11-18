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

import { Extension, type Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { ReactRenderer } from '@tiptap/react'
import { mentionPathPrefix, scanMentions } from '@/domain/command/mentionParser'
import { resolveFileType } from '@/core/lib/fileTypeMeta'
import { FileMentionIcon } from '@/ui/shared/FileMentionIcon'

export interface FileMentionTarget {
    path: string
    kind: 'file' | 'directory'
}

interface Mention extends FileMentionTarget {
    from: number
    to: number
}
interface FileMentionState {
    chosen: Mention[]
    decorations: DecorationSet
}

const FILE_MENTION_CHOICE_META = 'composer-file-mention-choice'
const pluginKey = new PluginKey<FileMentionState>('composer-file-mentions')

/** 从实际插入起点标出引用本身，不依赖补全后的光标或分隔空格。 */
export function fileMentionMetadata(target: FileMentionTarget, from: number) {
    const value: Mention = { ...target, from, to: from + 1 + target.path.length }
    return { key: FILE_MENTION_CHOICE_META, value }
}

/** 候选项真实类型只跟踪未改动的这段正文，不写进文档、草稿或消息协议。 */
function updateChoices(tr: Transaction, previous: Mention[], target: Mention | undefined): Mention[] {
    const kept: Mention[] = []
    const doc = tr.doc
    for (const hint of previous) {
        const from = tr.mapping.map(hint.from, 1)
        const to = tr.mapping.map(hint.to, -1)
        if (from >= to || to - from !== hint.to - hint.from) continue
        if (doc.textBetween(from, to, '\n', '￼') !== `@${hint.path}`) continue
        if (mentionPathPrefix(doc.textBetween(to, Math.min(to + 1, doc.content.size)))) continue
        kept.push({ ...hint, from, to })
    }
    if (target && doc.textBetween(target.from, target.to, '\n', '￼') === `@${target.path}`) {
        return [...kept.filter(hint => hint.to <= target.from || hint.from >= target.to), target]
    }
    return kept
}

type MentionRun = { from: number; to: number; matches: ReturnType<typeof scanMentions> }
const mentionRuns = new WeakMap<PMNode, MentionRun[]>()

/** PM 未改动的文本块保留节点引用；只缓存块内坐标，块移动时无需重新分词。 */
function runsFor(block: PMNode): MentionRun[] {
    const cached = mentionRuns.get(block)
    if (cached) return cached
    const runs: MentionRun[] = []
    let text = ''
    let from = 0
    const flush = () => {
        if (!text) return
        runs.push({ from, to: from + text.length, matches: scanMentions(text) })
        text = ''
    }
    block.forEach((inline, offset) => {
        if (inline.isText && !inline.marks.some(mark => mark.type.spec.code || mark.type.name === 'link')) {
            if (!text) from = offset
            text += inline.text ?? ''
        } else {
            flush()
        }
    })
    flush()
    mentionRuns.set(block, runs)
    return runs
}

function createDecorations(editor: Editor, doc: PMNode, choices: Mention[]): DecorationSet {
    const decorations: Decoration[] = []
    const renderers = new WeakMap<Node, { destroy(): void } | null>()
    const decorate = ({ from, to, path, kind: knownKind }: Omit<Mention, 'kind'> & { kind?: Mention['kind'] }) => {
        const type = knownKind === 'directory' ? null : resolveFileType(path)
        const kind = knownKind ?? type?.kind
        if (!kind) return
        const className = kind === 'directory' ? 'mention-directory' : 'mention-file'
        const key = type?.kind === 'file' ? `${className}:${type.ext}` : className
        decorations.push(Decoration.inline(from, to, { class: className }))
        decorations.push(Decoration.widget(from, view => {
            const dom = view.dom.ownerDocument.createElement('span')
            dom.className = kind === 'directory' ? 'file-mention-widget mention-directory' : 'file-mention-widget'
            dom.setAttribute('aria-hidden', 'true')
            dom.setAttribute('data-mention-icon', kind)
            renderers.set(dom, null)
            // ReactRenderer 初次挂载会 flushSync；放在编辑器 DOM 更新完成后，避免嵌套进页面挂载。
            queueMicrotask(() => {
                if (!renderers.has(dom) || editor.isDestroyed) return
                const renderer = new ReactRenderer(FileMentionIcon, { editor, props: { path, kind }, as: 'span' })
                renderers.set(dom, renderer)
                dom.append(renderer.element)
            })
            return dom
        }, {
            key,
            side: -1,
            ignoreSelection: true,
            destroy(dom) {
                renderers.get(dom)?.destroy()
                renderers.delete(dom)
            },
        }))
    }
    doc.descendants((block, blockPos) => {
        if (!block.isTextblock) return true
        if (block.type.spec.code) return false
        const base = blockPos + 1
        for (const run of runsFor(block)) {
            if (choices.length === 0 && run.matches.length === 0) continue
            const start = base + run.from
            const end = base + run.to
            const chosen = choices.filter(hint => hint.from >= start && hint.to <= end)
            chosen.forEach(decorate)
            for (const mention of run.matches) {
                const from = start + mention.from
                const to = start + mention.to
                if (chosen.some(hint => hint.from < to && hint.to > from)) continue
                decorate({ from, to, path: mention.path })
            }
        }
        return false
    })
    return decorations.length ? DecorationSet.create(doc, decorations) : DecorationSet.empty
}

/** 文件引用仍是可逐字编辑的文本；装饰不会进入剪贴板、wire 或 Markdown。 */
export const FileMentionDecoration = Extension.create({
    name: 'fileMentionDecoration',
    addProseMirrorPlugins() {
        const editor = this.editor
        return [new Plugin<FileMentionState>({
            key: pluginKey,
            state: {
                init: (_, { doc }) => ({ chosen: [], decorations: createDecorations(editor, doc, []) }),
                apply: (tr, previous) => {
                    const target = tr.getMeta(FILE_MENTION_CHOICE_META) as Mention | undefined
                    if (!tr.docChanged && !target) return previous
                    const chosen = updateChoices(tr, previous.chosen, target)
                    return { chosen, decorations: createDecorations(editor, tr.doc, chosen) }
                },
            },
            props: { decorations: state => pluginKey.getState(state)?.decorations },
        })]
    },
})
