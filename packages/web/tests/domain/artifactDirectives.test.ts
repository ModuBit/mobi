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
 * 产物声明 directive 语义层单测（spec .scratch/inline-artifacts 票 01）：
 * 参数解析容错、去重键、扩展名 → 类型白名单、inline 大小上限。
 */

import { describe, expect, it } from 'vitest'
import {
    ARTIFACT_INLINE_LIMIT_BYTES,
    isInlineCapableKind,
    parseArtifactParams,
    resolveArtifactKind,
} from '@/domain/chat/artifactDirectives'
import { dedupeDirectiveText } from '@/domain/chat/directives'

describe('parseArtifactParams', () => {
    it('path + 合法 mode', () => {
        expect(parseArtifactParams({ path: '/a/b.png', mode: 'card' })).toEqual({ path: '/a/b.png', mode: 'card' })
        expect(parseArtifactParams({ path: '/a/b.html', mode: 'wide' })).toEqual({ path: '/a/b.html', mode: 'wide' })
    })

    it('mode 缺省/非法 → undefined（auto，容错不降级）', () => {
        expect(parseArtifactParams({ path: '/a.png' })).toEqual({ path: '/a.png', mode: undefined })
        expect(parseArtifactParams({ path: '/a.png', mode: 'inline' })).toEqual({ path: '/a.png', mode: undefined })
        expect(parseArtifactParams({ path: '/a.png', mode: '' })).toEqual({ path: '/a.png', mode: undefined })
    })

    it('path 缺失/空白 → null（消费方按原文降级）', () => {
        expect(parseArtifactParams({})).toBeNull()
        expect(parseArtifactParams({ path: '' })).toBeNull()
        expect(parseArtifactParams({ path: '   ' })).toBeNull()
    })
})

describe('dedupeDirectiveText 对 artifact 的去重（注册键 = path）', () => {
    it('同路径只留首个，不同路径都保留', () => {
        const text = ':mobi-artifact{path="/a.png"} 中间 :mobi-artifact{path="/a.png"} 尾 :mobi-artifact{path="/b.png"}'
        expect(dedupeDirectiveText(text)).toBe(':mobi-artifact{path="/a.png"} 中间  尾 :mobi-artifact{path="/b.png"}')
    })
})

describe('resolveArtifactKind（扩展名白名单）', () => {
    it('登记类型按表命中，大小写不敏感', () => {
        expect(resolveArtifactKind('/a/b.PNG')).toBe('image')
        expect(resolveArtifactKind('/a/demo.html')).toBe('html')
        expect(resolveArtifactKind('/a/ song.mp3')).toBe('audio')
        expect(resolveArtifactKind('/a/clip.MOV')).toBe('video')
        expect(resolveArtifactKind('/a/report.pdf')).toBe('pdf')
    })

    it('未登记/无扩展名 → unknown', () => {
        expect(resolveArtifactKind('/a/b.xyz')).toBe('unknown')
        expect(resolveArtifactKind('/a/noext')).toBe('unknown')
    })
})

describe('inline 大小上限（spec Q10）', () => {
    it('图 8MB / 音视频 50MB / HTML 2MB', () => {
        expect(ARTIFACT_INLINE_LIMIT_BYTES.image).toBe(8 * 1024 * 1024)
        expect(ARTIFACT_INLINE_LIMIT_BYTES.audio).toBe(50 * 1024 * 1024)
        expect(ARTIFACT_INLINE_LIMIT_BYTES.video).toBe(50 * 1024 * 1024)
        expect(ARTIFACT_INLINE_LIMIT_BYTES.html).toBe(2 * 1024 * 1024)
    })

    it('pdf/unknown 不具 inline 能力', () => {
        expect(isInlineCapableKind('pdf')).toBe(false)
        expect(isInlineCapableKind('unknown')).toBe(false)
        expect(isInlineCapableKind('image')).toBe(true)
        expect(isInlineCapableKind('html')).toBe(true)
    })
})
