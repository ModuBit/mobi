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
import { buildReadFileUrl } from '@/core/utils/fileUrl'

/** 从生成的 URL 里取回 query，避免断言依赖参数顺序 */
function q(url: string) {
    return new URLSearchParams(url.slice(url.indexOf('?') + 1))
}

describe('buildReadFileUrl', () => {
    it('基础形态：带 path，不带多余参数', () => {
        const url = buildReadFileUrl('s1', 'src/a.png')
        expect(url.startsWith('/api/sessions/s1/read-file?')).toBe(true)
        const p = q(url)
        expect(p.get('path')).toBe('src/a.png')
        expect(p.get('v')).toBeNull()
        expect(p.get('download')).toBeNull()
        expect(p.get('_retry')).toBeNull()
    })

    it('etag 并入 v：内容变化即 URL 变化（图片刷新的关键）', () => {
        const a = buildReadFileUrl('s1', 'a.png', { etag: '100-1700000000000' })
        const b = buildReadFileUrl('s1', 'a.png', { etag: '250-1700000009999' })
        expect(q(a).get('v')).toBe('100-1700000000000')
        expect(a).not.toBe(b)
    })

    it('etag 不变则 URL 稳定（浏览器缓存可复用，不白下载）', () => {
        const a = buildReadFileUrl('s1', 'a.png', { etag: 'same' })
        const b = buildReadFileUrl('s1', 'a.png', { etag: 'same' })
        expect(a).toBe(b)
    })

    it('download=1 用于下载入口', () => {
        expect(q(buildReadFileUrl('s1', 'a.zip', { download: true })).get('download')).toBe('1')
    })

    it('retry 与 etag 相互独立：文件未变也能造出新 URL 绕缓存重认证', () => {
        const first = buildReadFileUrl('s1', 'a.png', { etag: 'same' })
        const retried = buildReadFileUrl('s1', 'a.png', { etag: 'same', retry: 2 })
        expect(q(retried).get('_retry')).toBe('2')
        expect(q(retried).get('v')).toBe('same')
        expect(retried).not.toBe(first)
    })

    it('retry=0 视为未重试，不产出 _retry（保持基础 URL 稳定）', () => {
        expect(q(buildReadFileUrl('s1', 'a.png', { retry: 0 })).get('_retry')).toBeNull()
    })

    it('特殊字符转义：空格 / 中文 / # / & 原样解析回来', () => {
        const messy = 'dir with space/中文 & 符号#1.png'
        const p = q(buildReadFileUrl('s1', messy))
        expect(p.get('path')).toBe(messy)
    })
})
