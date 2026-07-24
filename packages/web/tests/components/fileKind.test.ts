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
import { resolveFileKind } from '@/components/files/fileKind'
import type { FileMeta } from '@/core/data/hooks/queries/useFileTree'

const meta = (mime: string, size = 100): FileMeta =>
    ({ mime, size, etag: 'e' })

describe('resolveFileKind', () => {
    it('application/pdf → pdf', () => {
        expect(resolveFileKind(meta('application/pdf'), 'a.pdf')).toEqual({ kind: 'pdf' })
    })

    it('image/* → image', () => {
        expect(resolveFileKind(meta('image/png'), 'a.png')).toEqual({ kind: 'image' })
    })

    it('原生音视频 → media-native（带 isAudio）', () => {
        expect(resolveFileKind(meta('video/mp4'), 'a.mp4')).toEqual({ kind: 'media-native', isAudio: false })
        expect(resolveFileKind(meta('audio/mp3'), 'a.mp3')).toEqual({ kind: 'media-native', isAudio: true })
    })

    it('非原生音视频 → media-download', () => {
        expect(resolveFileKind(meta('video/x-matroska'), 'a.mkv')).toEqual({ kind: 'media-download' })
    })

    it('text/markdown → markdown（优先于 text）', () => {
        expect(resolveFileKind(meta('text/markdown'), 'a.md')).toEqual({ kind: 'markdown' })
    })

    it('text/html → html（优先于 text，供预览/源码切换）', () => {
        expect(resolveFileKind(meta('text/html'), 'a.html')).toEqual({ kind: 'html' })
        expect(resolveFileKind(meta('text/html'), 'a.htm')).toEqual({ kind: 'html' })
    })

    it('text-like 各子类 → text', () => {
        for (const m of ['text/plain', 'application/json', 'application/xml', 'application/x-sh', 'application/sql', 'application/toml']) {
            expect(resolveFileKind(meta(m), 'f')).toEqual({ kind: 'text', highlight: true })
        }
    })

    it('text 高亮阈值：size >= 1MB → highlight:false', () => {
        expect(resolveFileKind(meta('text/plain', 1024 * 1024)).highlight).toBe(false)
        expect(resolveFileKind(meta('text/plain', 1024 * 1024 - 1)).highlight).toBe(true)
    })

    it('不可直显 → binary', () => {
        expect(resolveFileKind(meta('application/zip'), 'a.zip')).toEqual({ kind: 'binary' })
        expect(resolveFileKind(meta('application/octet-stream'), 'a.bin')).toEqual({ kind: 'binary' })
    })

    it('优先级：pdf 先于 image mime 前缀判定（pdf 不被 application/* 当 binary）', () => {
        expect(resolveFileKind(meta('application/pdf'), 'a.pdf')).toEqual({ kind: 'pdf' })
    })
})
