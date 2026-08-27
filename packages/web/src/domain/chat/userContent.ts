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

import type { UserContentBlock, UserContentSource, UserDocumentBlock, UserImageBlock, UserQuoteBlock, UserTextBlock } from '@mobi/shared'

/** 【过渡】取 blocks 的首个非空 text 文本；命令识别等「首文本」语义场景专用（渲染已改走 UserBlocksView） */
export function getUserPlainText(blocks: UserContentBlock[]): string {
    for (const b of blocks) {
        if (b.type === 'text' && b.text.trim()) return b.text
    }
    return ''
}

/** 聚合 blocks 中全部 text 原文（'\n' 连接）。折叠高度预估与复制文案共用——
 * 多段 text 的消息只有全量聚合才能反映真实内容量 */
export function collectUserText(blocks: readonly UserContentBlock[]): string {
    return blocks.filter((b): b is UserTextBlock => b.type === 'text').map(b => b.text).join('\n')
}

/** 渲染分段：连续 document / 连续 image 各归并为一段（气泡内分别以横向容器合并展示），其余 block 各占一段 */
export type UserBlockGroup =
    | { kind: 'block'; block: UserContentBlock }
    | { kind: 'documents'; blocks: UserDocumentBlock[] }
    | { kind: 'images'; blocks: UserImageBlock[] }

export function groupUserBlocks(blocks: readonly UserContentBlock[]): UserBlockGroup[] {
    const out: UserBlockGroup[] = []
    for (const b of blocks) {
        const last = out[out.length - 1]
        if (b.type === 'document') {
            if (last?.kind === 'documents') last.blocks.push(b)
            else out.push({ kind: 'documents', blocks: [b] })
        } else if (b.type === 'image') {
            if (last?.kind === 'images') last.blocks.push(b)
            else out.push({ kind: 'images', blocks: [b] })
        } else {
            out.push({ kind: 'block', block: b })
        }
    }
    return out
}

function isSameSource(a: UserContentSource, b: UserContentSource): boolean {
    return a.type === b.type && a.value === b.value && a.mimeType === b.mimeType
}

function isSameBlock(a: UserContentBlock, b: UserContentBlock): boolean {
    if (a.type !== b.type) return false
    // tag 相同后 b 与 a 同型（discriminatedUnion），按各自字段逐一比较
    switch (a.type) {
        case 'text':
            return a.text === (b as UserTextBlock).text
        case 'quote': {
            const q = b as UserQuoteBlock
            return a.messageId === q.messageId && a.role === q.role && a.excerpt === q.excerpt
        }
        case 'image':
        case 'document': {
            const d = b as typeof a
            return a.id === d.id
                && a.filename === d.filename
                && a.size === d.size
                && a.previewUrl === d.previewUrl
                && isSameSource(a.source, d.source)
        }
    }
}

/**
 * blocks 数组结构相等（CollapsibleUserMessage memo 比较器用）。
 * 引用相等短路——reducer / snapshot→full 替换会换数组对象但内容常相同，
 * 此时逐字段比对避免用户消息气泡无谓重渲。
 */
export function areUserBlocksEqual(a: readonly UserContentBlock[], b: readonly UserContentBlock[]): boolean {
    if (a === b) return true
    if (a.length !== b.length) return false
    return a.every((x, i) => isSameBlock(x, b[i]))
}
