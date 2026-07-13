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
import { saveDraft, getDraft, clearDraft } from '@/core/lib/composerDrafts'
import type { FileAttachment } from '@/core/lib/fileAttachments'

function attach(id: string, name: string, path: string, size = 1024): FileAttachment {
    return { id, file: new File([], name), status: 'complete', path, name, size }
}

describe('composerDrafts', () => {
    beforeEach(() => {
        sessionStorage.clear()
    })

    it('save 后 get 能读到 text 与 complete 附件', () => {
        saveDraft('s1', 'hello', [attach('a1', 'f.png', '/p/f.png', 2048)])
        const d = getDraft('s1')!
        expect(d.text).toBe('hello')
        expect(d.attachments).toEqual([{ id: 'a1', name: 'f.png', path: '/p/f.png', size: 2048 }])
    })

    it('只持久化 status=complete 且有 path 的附件，过滤 uploading/error/无 path', () => {
        const list: FileAttachment[] = [
            { id: 'up', file: new File([], 'up.txt'), status: 'uploading' },
            { id: 'err', file: new File([], 'err.txt'), status: 'error', path: '/p/err.txt' },
            { id: 'nopath', file: new File([], 'np.txt'), status: 'complete' },
            attach('ok', 'ok.txt', '/p/ok.txt', 10),
        ]
        saveDraft('s1', 't', list)
        expect(getDraft('s1')!.attachments).toEqual([{ id: 'ok', name: 'ok.txt', path: '/p/ok.txt', size: 10 }])
    })

    it('text 空且无 complete 附件时删除 key', () => {
        saveDraft('s1', 't', [attach('a1', 'f.png', '/p/f.png')])
        saveDraft('s1', '   ', [])
        expect(getDraft('s1')).toBeNull()
    })

    it('clearDraft 删除指定 session', () => {
        saveDraft('s1', 't', [])
        clearDraft('s1')
        expect(getDraft('s1')).toBeNull()
    })

    it('LRU：超过 50 条删最早；重复 save 刷新顺序', () => {
        for (let i = 0; i < 50; i++) saveDraft(`s${i}`, `t${i}`, [])
        saveDraft('s0', 'updated', []) // 刷新 s0 到最新
        saveDraft('s50', 'new', [])     // 触发淘汰，应删 s1（最早的未刷新项）
        expect(getDraft('s0')!.text).toBe('updated')
        expect(getDraft('s1')).toBeNull()
        expect(getDraft('s50')!.text).toBe('new')
    })

    it('损坏 JSON 不抛错，回退空 map', () => {
        sessionStorage.setItem('mobi:composer-drafts', '{not json')
        expect(getDraft('any')).toBeNull()
        // 之后 save 能正常工作
        saveDraft('s1', 't', [])
        expect(getDraft('s1')!.text).toBe('t')
    })
})
