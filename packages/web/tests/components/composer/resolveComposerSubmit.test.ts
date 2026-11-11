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

import { describe, it, expect } from 'vitest'
import { resolveComposerSubmit } from '@/features/composer/resolveComposerSubmit'
import type { FileAttachment } from '@/core/lib/fileAttachments'
import type { ComposerQuoteRef } from '@/domain/chat/composerSegments'

function attachment(overrides: Partial<FileAttachment> & { name: string }): FileAttachment {
    const { name, ...rest } = overrides
    return {
        id: `a-${name}`,
        file: new File([], name),
        status: 'complete',
        path: `/u/${name}`,
        name,
        size: 10,
        ...rest,
    }
}

const quote: ComposerQuoteRef = {
    uid: 'q1',
    messageId: 'm1',
    role: 'agent',
    excerpt: '被引用的片段',
}

describe('resolveComposerSubmit', () => {
    it('enabled=false：直接返回 disabled（不组装分段）', () => {
        const result = resolveComposerSubmit({
            text: 'hello', attachments: [], panelOpen: false, enabled: false,
        })
        expect(result).toEqual({ ok: false, blocked: 'disabled' })
    })

    it('面板开着：返回 panel-open（Enter 是选择不是提交）', () => {
        const result = resolveComposerSubmit({
            text: 'hello', attachments: [], panelOpen: true, enabled: true,
        })
        expect(result).toEqual({ ok: false, blocked: 'panel-open' })
    })

    it('有上传中附件：返回 uploading（优先于 empty，避免静默丢附件）', () => {
        const result = resolveComposerSubmit({
            text: '',
            attachments: [attachment({ name: 'big.bin', status: 'uploading', path: undefined })],
            panelOpen: false,
            enabled: true,
        })
        expect(result).toEqual({ ok: false, blocked: 'uploading' })
    })

    it('全空：返回 empty', () => {
        const result = resolveComposerSubmit({
            text: '   ', attachments: [], panelOpen: false, enabled: true,
        })
        expect(result).toEqual({ ok: false, blocked: 'empty' })
    })

    it('仅文本：返回完整分段（files/images 空桶）', () => {
        const result = resolveComposerSubmit({
            text: 'hello', attachments: [], panelOpen: false, enabled: true,
        })
        expect(result).toEqual({
            ok: true,
            segments: { text: 'hello', files: [], images: [], quotes: [] },
        })
    })

    it('完成附件按类型分桶：png 进 images、pdf 进 files', () => {
        const result = resolveComposerSubmit({
            text: '',
            attachments: [attachment({ name: 'p.png' }), attachment({ name: 'd.pdf' })],
            panelOpen: false,
            enabled: true,
        })
        expect(result.ok).toBe(true)
        if (!result.ok) return
        expect(result.segments.images.map(r => r.filename)).toEqual(['p.png'])
        expect(result.segments.files.map(r => r.filename)).toEqual(['d.pdf'])
    })

    it('文本 + 引用 + 附件：三条通道全量保留', () => {
        const result = resolveComposerSubmit({
            text: '正文',
            quotes: [quote],
            attachments: [attachment({ name: 'p.png' })],
            panelOpen: false,
            enabled: true,
        })
        expect(result.ok).toBe(true)
        if (!result.ok) return
        expect(result.segments.text).toBe('正文')
        expect(result.segments.quotes).toEqual([quote])
        expect(result.segments.images).toHaveLength(1)
    })

    it('quotes 缺省：分段里是空数组', () => {
        const result = resolveComposerSubmit({
            text: 'x', attachments: [], panelOpen: false, enabled: true,
        })
        expect(result.ok).toBe(true)
        if (!result.ok) return
        expect(result.segments.quotes).toEqual([])
    })

    it('error 附件：既不触发 uploading 守卫，也不进分段', () => {
        const result = resolveComposerSubmit({
            text: 'x',
            attachments: [attachment({ name: 'bad.bin', status: 'error' })],
            panelOpen: false,
            enabled: true,
        })
        expect(result.ok).toBe(true)
        if (!result.ok) return
        expect(result.segments.files).toEqual([])
        expect(result.segments.images).toEqual([])
    })

    it('优先级：disabled > panel-open > uploading > empty', () => {
        const uploading = attachment({ name: 'u.bin', status: 'uploading', path: undefined })
        expect(resolveComposerSubmit({
            text: '', attachments: [uploading], panelOpen: true, enabled: false,
        })).toEqual({ ok: false, blocked: 'disabled' })
        expect(resolveComposerSubmit({
            text: '', attachments: [uploading], panelOpen: true, enabled: true,
        })).toEqual({ ok: false, blocked: 'panel-open' })
        expect(resolveComposerSubmit({
            text: '', attachments: [uploading], panelOpen: false, enabled: true,
        })).toEqual({ ok: false, blocked: 'uploading' })
    })
})
