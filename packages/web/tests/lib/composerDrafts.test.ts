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

import { describe, it, expect, beforeEach } from 'vitest'
import { saveDraft, getDraft, clearDraft, mergeDraftText, __resetDraftCacheForTesting } from '@/core/lib/composerDrafts'
import type { ComposerSegments } from '@/domain/chat/composerSegments'
import type { BlockFileRef } from '@/domain/chat/composerSegments'

/** 空分段工厂（text 可传） */
function seg(text = '', overrides: Partial<ComposerSegments> = {}): ComposerSegments {
    return { text, files: [], images: [], quotes: [], ...overrides }
}

function fileRef(id: string, filename: string, path: string): BlockFileRef {
    return { id, filename, path, mimeType: 'application/octet-stream', size: 1024 }
}

describe('composerDrafts', () => {
    beforeEach(() => {
        sessionStorage.clear()
        __resetDraftCacheForTesting()
    })

    it('分段持久化往返：save 后 get 完整还原 text + files/images/quotes 三桶', () => {
        const draft = seg('hello', {
            files: [fileRef('f1', 'r.pdf', '/u/r.pdf')],
            images: [{ id: 'g1', filename: 'p.png', path: '/u/p.png', mimeType: 'image/png', size: 7 }],
            quotes: [{ messageId: 'm1', role: 'agent', excerpt: '引用正文' }],
        })
        saveDraft('s1', draft)
        expect(getDraft('s1')).toEqual(draft)
    })

    it('previewUrl 不落盘（blob URL 跨会话失效）；恢复侧仅保留可持久化字段', () => {
        const draft = seg('t', { files: [{ ...fileRef('f1', 'r.pdf', '/u/r.pdf'), previewUrl: 'blob:x' }] })
        saveDraft('s1', draft)
        expect(getDraft('s1')!.files[0]).not.toHaveProperty('previewUrl')
    })

    it('旧版 {text, attachments:[{id,name,path,size}]} 草稿加载为 files 桶（mimeType 空串、images/quotes 补空）', () => {
        sessionStorage.setItem('mobi:composer-drafts', JSON.stringify({
            s1: { text: 'legacy', attachments: [{ id: 'a1', name: 'f.png', path: '/p/f.png', size: 2048 }] },
        }))
        __resetDraftCacheForTesting()
        expect(getDraft('s1')).toEqual(seg('legacy', {
            files: [{ id: 'a1', filename: 'f.png', path: '/p/f.png', mimeType: '', size: 2048 }],
        }))
    })

    it('分段字段损坏逐条剔除不整单拒绝；非法 draft（缺 text）拒绝', () => {
        sessionStorage.setItem('mobi:composer-drafts', JSON.stringify({
            s1: {
                text: 'partial',
                files: [fileRef('ok', 'a.txt', '/a.txt'), { id: 42 }, 'junk'],
                images: [],
                quotes: [{ messageId: 'm', role: 'nonsense', excerpt: 'x' }],
            },
            s2: { attachments: [] },
        }))
        __resetDraftCacheForTesting()
        const d = getDraft('s1')!
        expect(d.files).toEqual([fileRef('ok', 'a.txt', '/a.txt')])
        expect(d.quotes).toEqual([])
        expect(getDraft('s2')).toBeNull()
    })

    it('text 空且三桶全空时删除 key；有内容则保留', () => {
        saveDraft('s1', seg('t', { files: [fileRef('f1', 'f.txt', '/f.txt')] }))
        saveDraft('s1', seg('   '))
        expect(getDraft('s1')).toBeNull()
        // quotes 非空也算有内容，不被空文本清掉
        saveDraft('s1', seg('', { quotes: [{ messageId: 'm1', role: 'user', excerpt: 'q' }] }))
        expect(getDraft('s1')!.quotes).toHaveLength(1)
    })

    it('clearDraft 删除指定 session', () => {
        saveDraft('s1', seg('t'))
        clearDraft('s1')
        expect(getDraft('s1')).toBeNull()
    })

    it('LRU：超过 50 条删最早；重复 save 刷新顺序', () => {
        for (let i = 0; i < 50; i++) saveDraft(`s${i}`, seg(`t${i}`))
        saveDraft('s0', seg('updated')) // 刷新 s0 到最新
        saveDraft('s50', seg('new'))    // 触发淘汰，应删 s1（最早的未刷新项）
        expect(getDraft('s0')!.text).toBe('updated')
        expect(getDraft('s1')).toBeNull()
        expect(getDraft('s50')!.text).toBe('new')
    })

    it('损坏 JSON 不抛错，回退空 map', () => {
        sessionStorage.setItem('mobi:composer-drafts', '{not json')
        expect(getDraft('any')).toBeNull()
        // 之后 save 能正常工作
        saveDraft('s1', seg('t'))
        expect(getDraft('s1')!.text).toBe('t')
    })

    it('mergeDraftText 保留既有文件/图片/引用分段，只更新 text', () => {
        const old = seg('old', {
            files: [fileRef('f1', 'r.pdf', '/u/r.pdf')],
            images: [{ id: 'g1', filename: 'p.png', path: '/u/p.png', mimeType: 'image/png', size: 7 }],
            quotes: [{ messageId: 'm1', role: 'user', excerpt: 'q' }],
        })
        saveDraft('s1', old)
        mergeDraftText('s1', 'new text')
        expect(getDraft('s1')).toEqual({ ...old, text: 'new text' })
    })

    it('mergeDraftText 在文本与既有分段全空时删除 key', () => {
        saveDraft('s1', seg('old'))
        mergeDraftText('s1', '   ')
        expect(getDraft('s1')).toBeNull()
    })

    it('getDraft 读刷新 LRU 顺序（高频读的老 session 不被优先淘汰）', () => {
        for (let i = 0; i < 50; i++) saveDraft(`s${i}`, seg(`t${i}`))
        getDraft('s0') // 读刷新 s0 到最新
        saveDraft('s50', seg('t50')) // 触发淘汰，应删 s1（最早未刷新项）
        expect(getDraft('s0')?.text).toBe('t0')
        expect(getDraft('s1')).toBeNull()
    })

    // persist 写入失败（quota）时 cache 不被 evict 提交的降级行为，
    // 因 jsdom 无法 mock 原生 Storage.prototype.setItem 而未覆盖单测；
    // 实现上 persist 仅在 setItem 成功后才赋值 cache，失败时 cache 保持旧值。
})
