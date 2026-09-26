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
    classifyArtifact,
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

describe('classifyArtifact（渲染裁决纯函数，裁决顺序收口）', () => {
    const READY = { status: 'ready' as const, size: 1024, etag: 'e1' }

    it('pending → 无原因卡（校验未决不预判）', () => {
        expect(classifyArtifact('/a.png', { status: 'pending' })).toEqual({ action: 'card' })
    })

    it('missing → missing 卡（不存在/越界），且优先于 unsupported（缺失的 pdf 标缺失不标不支持）', () => {
        expect(classifyArtifact('/a.png', { status: 'missing' })).toEqual({ action: 'card', reason: 'missing' })
        expect(classifyArtifact('/a.pdf', { status: 'missing' })).toEqual({ action: 'card', reason: 'missing' })
    })

    it('pdf/unknown → unsupported 卡（meta ready 才谈得上类型裁决）', () => {
        expect(classifyArtifact('/a.pdf', READY)).toEqual({ action: 'card', reason: 'unsupported' })
        expect(classifyArtifact('/a.bin', READY)).toEqual({ action: 'card', reason: 'unsupported' })
    })

    it('超限 → too-large 卡（kind 决定上限）', () => {
        const oversize = { status: 'ready' as const, size: 9 * 1024 * 1024, etag: 'e1' }
        expect(classifyArtifact('/big.png', oversize)).toEqual({ action: 'card', reason: 'too-large' })
        // mode="card" 不豁免超限判定（超限先于 mode 覆盖）
        expect(classifyArtifact('/big.html', oversize, 'card')).toEqual({ action: 'card', reason: 'too-large' })
    })

    it('mode="card" → 无原因卡（用户/模型意愿覆盖 inline 能力）', () => {
        expect(classifyArtifact('/a.png', READY, 'card')).toEqual({ action: 'card' })
    })

    it('校验全过 → inline verdict：kind/etag/wide 齐备（wide 仅 html 语义成立，统一带出）', () => {
        expect(classifyArtifact('/a.png', READY)).toEqual({ action: 'inline', kind: 'image', etag: 'e1', wide: false })
        expect(classifyArtifact('/a.mp4', READY)).toEqual({ action: 'inline', kind: 'video', etag: 'e1', wide: false })
        expect(classifyArtifact('/a.html', READY, 'wide')).toEqual({ action: 'inline', kind: 'html', etag: 'e1', wide: true })
        expect(classifyArtifact('/a.html', READY)).toEqual({ action: 'inline', kind: 'html', etag: 'e1', wide: false })
    })
})
