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
 * serveVizDocument 处理器单测（visualize-runtime 票 02）。
 *
 * 回归锚点：读文件前只判字节超限——预校验传空串曾把一切请求误判成
 * 「Fragment is empty」（2026-10-16 E2E 实锤）。此测试锁「合法 fragment
 * 请求返回组装文档而非错误页」。
 */

import { describe, test, expect } from 'bun:test'
import type { FileContentReader } from '../../../src/web/routes/serveFileContent'
import { serveVizDocument } from '../../../src/web/routes/serveVizDocument'

const FRAGMENT = '<h2>季度营收</h2><div class="viz-grid"><div class="card"><div class="viz-stat-value">¥48.2万</div></div></div>'

const makeReader = (content: string): FileContentReader => {
    const bytes = new TextEncoder().encode(content)
    return {
        readFileMeta: async () => ({ success: true, meta: { mime: 'text/html', size: bytes.byteLength, etag: 'e1' }, writable: false }),
        readFileRange: async (_p, offset, length) => ({ success: true, chunk: bytes.slice(offset, offset + length) }),
    }
}

/** serveVizDocument 只在失败路径触 c.json；成功路径不碰 context——最小桩即可 */
const fakeContext: Parameters<typeof serveVizDocument>[0] = {
    json: ((body: unknown, status?: number) => new Response(JSON.stringify(body), { status: status ?? 200 })) as never,
} as never

describe('serveVizDocument', () => {
    test('合法 fragment → 200 组装文档（含 token 与 fragment 原文），非错误页', async () => {
        const res = await serveVizDocument(fakeContext, makeReader(FRAGMENT), '/tmp/viz-demo.html')
        const text = await res.text()
        expect(res.status).toBe(200)
        expect(text).toContain('--viz-bg')
        expect(text).toContain(FRAGMENT)
        expect(text).not.toContain('role="alert"')
    })

    test('空文件 → 422 错误页', async () => {
        const res = await serveVizDocument(fakeContext, makeReader('   '), '/tmp/empty.html')
        expect(res.status).toBe(422)
        expect(await res.text()).toContain('Fragment is empty')
    })

    test('完整 HTML 文档喂进 viz 档 → 422（档位契约拒绝）', async () => {
        const res = await serveVizDocument(fakeContext, makeReader('<!doctype html><div></div>'), '/tmp/full.html')
        expect(res.status).toBe(422)
        expect(await res.text()).toContain('complete HTML document')
    })

    test('CSP 头与 no-cache 随组装文档下发', async () => {
        const res = await serveVizDocument(fakeContext, makeReader(FRAGMENT), '/tmp/a.html')
        expect(res.headers.get('content-security-policy')).toContain("default-src 'none'")
        expect(res.headers.get('cache-control')).toBe('private, no-cache')
        expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    })
})
