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

import { Extension } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { mentionPathPrefix, scanMentions } from '@/domain/command/mentionParser'
import { resolveFileType } from '@/core/lib/fileTypeMeta'
import { fileMentionWidget } from '@/ui/shared/MentionDirectoryIcon'

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
    block.forEach((inline, offset) => {
        if (!inline.isText || inline.marks.some(mark => mark.type.spec.code || mark.type.name === 'link')) return
        // PM 合并相邻的同 mark 文本；不同节点的边界对应 Markdown 标记或原子边界。
        const text = inline.text ?? ''
        runs.push({ from: offset, to: offset + text.length, matches: scanMentions(text) })
    })
    mentionRuns.set(block, runs)
    return runs
}

function createDecorations(doc: PMNode, choices: Mention[]): DecorationSet {
    const decorations: Decoration[] = []
    const decorate = ({ from, to, path, kind: knownKind }: Omit<Mention, 'kind'> & { kind?: Mention['kind'] }) => {
        const type = knownKind === 'directory' ? null : resolveFileType(path)
        const kind = knownKind ?? type?.kind
        if (!kind) return
        const className = kind === 'directory' ? 'mention-directory' : 'mention-file'
        const key = type?.kind === 'file' ? `${className}:${type.ext}` : className
        decorations.push(Decoration.inline(from, to, { class: className }))
        decorations.push(Decoration.widget(from, fileMentionWidget(kind, type), {
            key,
            side: -1,
            ignoreSelection: true,
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
        return [new Plugin<FileMentionState>({
            key: pluginKey,
            state: {
                init: (_, { doc }) => ({ chosen: [], decorations: createDecorations(doc, []) }),
                apply: (tr, previous) => {
                    const target = tr.getMeta(FILE_MENTION_CHOICE_META) as Mention | undefined
                    if (!tr.docChanged && !target) return previous
                    const chosen = updateChoices(tr, previous.chosen, target)
                    return { chosen, decorations: createDecorations(tr.doc, chosen) }
                },
            },
            props: { decorations: state => pluginKey.getState(state)?.decorations },
        })]
    },
})
