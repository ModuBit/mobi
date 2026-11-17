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

import { describe, expect, it } from 'vitest'
import { shouldRuntimeCache, type RuntimeCacheRequest } from '@/core/pwa/swCache'

const ORIGIN = 'https://mobi.example.com'

/** 构造请求形状，默认同源 GET */
function req(partial: Partial<RuntimeCacheRequest>): RuntimeCacheRequest {
    return {
        url: `${ORIGIN}/assets/chunk-a.js`,
        method: 'GET',
        destination: 'script',
        ...partial,
    }
}

/**
 * 预缓存遗漏的按需资源走运行时缓存（方案 A）：只接管同源 GET 的
 * JS/CSS chunk 与画板字体分片；其余请求（API、导航、跨域）一律放行。
 */
describe('shouldRuntimeCache', () => {
    it('/assets/ 下的脚本命中', () => {
        expect(shouldRuntimeCache(req({}), ORIGIN)).toBe(true)
    })

    it('/assets/ 下的样式命中', () => {
        expect(
            shouldRuntimeCache(
                req({ url: `${ORIGIN}/assets/editor-abc.css`, destination: 'style' }),
                ORIGIN
            )
        ).toBe(true)
    })

    it('/excalidraw-assets/ 下的字体分片命中', () => {
        expect(
            shouldRuntimeCache(
                req({
                    url: `${ORIGIN}/excalidraw-assets/fonts/Virgil/Virgil.woff2`,
                    destination: 'font',
                }),
                ORIGIN
            )
        ).toBe(true)
    })

    it('API 请求不接管', () => {
        expect(
            shouldRuntimeCache(
                req({ url: `${ORIGIN}/api/sessions`, destination: 'empty' }),
                ORIGIN
            )
        ).toBe(false)
    })

    it('非脚本/样式/字体类型不接管（如图片与文档）', () => {
        expect(
            shouldRuntimeCache(req({ url: `${ORIGIN}/assets/photo.png`, destination: 'image' }), ORIGIN)
        ).toBe(false)
        expect(
            shouldRuntimeCache(req({ url: `${ORIGIN}/assets/index.html`, destination: 'document' }), ORIGIN)
        ).toBe(false)
    })

    it('非 GET 不接管', () => {
        expect(shouldRuntimeCache(req({ method: 'POST' }), ORIGIN)).toBe(false)
    })

    it('跨域资源不接管', () => {
        expect(
            shouldRuntimeCache(req({ url: 'https://cdn.example.com/assets/a.js' }), ORIGIN)
        ).toBe(false)
    })

    it('非法 url 不接管', () => {
        expect(shouldRuntimeCache(req({ url: 'not a url' }), ORIGIN)).toBe(false)
    })
})
