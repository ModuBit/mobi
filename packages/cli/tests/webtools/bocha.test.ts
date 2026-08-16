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

import { describe, expect, it, vi, afterEach } from 'vitest'
import { createBochaProvider, extractTextFromHtml } from '@/webtools/providers/bocha'

afterEach(() => vi.unstubAllGlobals())

describe('bocha search', () => {
    it('webPages.value → 统一格式', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ code: 200, data: { webPages: { value: [
                { name: '结果', url: 'https://b.com/1', snippet: '摘要', summary: '总结' },
            ] } } }),
        })
        vi.stubGlobal('fetch', fetchMock)
        const provider = createBochaProvider({ apiKey: 'k', timeoutMs: 1000 })
        const results = await provider.search({ query: 'q' })
        expect(results[0]).toEqual({ title: '结果', url: 'https://b.com/1', snippet: '摘要' })
        // Bearer 鉴权
        expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({ authorization: 'Bearer k' })
    })
    it('code 401/403 → WebToolError（code=auth）', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ code: 401, msg: 'bad key' }) }))
        const provider = createBochaProvider({ apiKey: 'bad', timeoutMs: 1000 })
        await expect(provider.search({ query: 'q' })).rejects.toMatchObject({ code: 'auth', providerId: 'bocha' })
    })
    it('code 其它非 200 → WebToolError（code=upstream）', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ code: 429, msg: 'rate limited' }) }))
        const provider = createBochaProvider({ apiKey: 'k', timeoutMs: 1000 })
        await expect(provider.search({ query: 'q' })).rejects.toMatchObject({ code: 'upstream', providerId: 'bocha' })
    })
})

describe('bocha fetch（直连抓取 + 简易正文提取）', () => {
    it('html → 去 script/style/nav、剥标签、解实体', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
            text: async () => '<html><head><style>x{}</style></head><body><nav>菜单</nav><main><h1>标题</h1><p>正文&amp;内容</p></main></body></html>',
        }))
        const provider = createBochaProvider({ apiKey: 'k', timeoutMs: 1000 })
        const result = await provider.fetch({ url: 'https://b.com', prompt: 'p' })
        expect(result.content).toContain('标题')
        expect(result.content).toContain('正文&内容')
        expect(result.content).not.toContain('x{}')
        expect(result.content).not.toContain('菜单')
    })
    it('markdown 源直返', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            headers: new Headers({ 'content-type': 'text/markdown' }),
            text: async () => '# md 标题',
        }))
        const provider = createBochaProvider({ apiKey: 'k', timeoutMs: 1000 })
        const result = await provider.fetch({ url: 'https://b.com/a.md', prompt: 'p' })
        expect(result.content).toBe('# md 标题')
    })
    it('直连 HTTP 404 → code=auth（4xx 归凭据/参数问题）', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, statusText: 'Not Found' }))
        const provider = createBochaProvider({ apiKey: 'k', timeoutMs: 1000 })
        await expect(provider.fetch({ url: 'https://b.com/none', prompt: 'p' })).rejects.toMatchObject({ code: 'auth', providerId: 'bocha' })
    })
    it('直连 HTTP 429 → code=upstream（限流非凭据问题）', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429, statusText: 'Too Many Requests' }))
        const provider = createBochaProvider({ apiKey: 'k', timeoutMs: 1000 })
        await expect(provider.fetch({ url: 'https://b.com', prompt: 'p' })).rejects.toMatchObject({ code: 'upstream', providerId: 'bocha' })
    })
    it('直连 HTTP 500 → code=upstream（上游不稳）', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: 'Internal Server Error' }))
        const provider = createBochaProvider({ apiKey: 'k', timeoutMs: 1000 })
        await expect(provider.fetch({ url: 'https://b.com', prompt: 'p' })).rejects.toMatchObject({ code: 'upstream', providerId: 'bocha' })
    })
    it('超长正文截断到上限并附说明', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            headers: new Headers({ 'content-type': 'text/plain' }),
            text: async () => 'x'.repeat(60_000),
        }))
        const provider = createBochaProvider({ apiKey: 'k', timeoutMs: 1000 })
        const result = await provider.fetch({ url: 'https://b.com', prompt: 'p' })
        expect(result.content.length).toBeLessThan(60_000)
        expect(result.content).toContain('[内容过长，已截断至')
    })
    it('抓取超时 → code=timeout', async () => {
        vi.stubGlobal('fetch', vi.fn().mockImplementation((_u: string, init: RequestInit) =>
            new Promise((_res, rej) => {
                // 兜底 2000ms：远大于 provider 的 30ms 超时又留足与 vitest 默认 5s testTimeout 的余量，避免 flaky。
                // 直连 fetch 的超时走 AbortError 判定（error.name === 'AbortError'），mock reject 的错误 name 必须是 'AbortError' 才能命中 timeout 分支
                const abortLike = () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))
                const t = setTimeout(abortLike, 2000)
                init?.signal?.addEventListener('abort', () => { clearTimeout(t); abortLike() })
            }),
        ))
        const provider = createBochaProvider({ apiKey: 'k', timeoutMs: 30 })
        await expect(provider.fetch({ url: 'https://b.com', prompt: 'p' })).rejects.toMatchObject({ code: 'timeout', providerId: 'bocha' })
    })
    it('空正文 → code=empty', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            headers: new Headers({ 'content-type': 'text/plain' }),
            text: async () => '   ',
        }))
        const provider = createBochaProvider({ apiKey: 'k', timeoutMs: 1000 })
        await expect(provider.fetch({ url: 'https://b.com', prompt: 'p' })).rejects.toMatchObject({ code: 'empty', providerId: 'bocha' })
    })
})

describe('extractTextFromHtml（纯函数，锁定启发式边界，为将来换 linkedom+turndown 留回归基线）', () => {
    it('相邻块级元素无分隔（现状短板：仅剥标签不补换行）', () => {
        // 记录现状：v1 启发式不识别块级边界，<p>a</p><p>b</p> 粘连为 "ab"
        expect(extractTextFromHtml('<p>a</p><p>b</p>')).toBe('ab')
    })
    it('HTML 注释被剥掉', () => {
        expect(extractTextFromHtml('<p>正文</p><!-- 注释内容 -->')).toBe('正文')
    })
    it('数字实体（如 &#x27;）不解码（v1 仅解具名实体）', () => {
        expect(extractTextFromHtml('<p>it&#x27;s</p>')).toBe('it&#x27;s')
    })
    it('未闭合 script 的内容泄漏进正文（现状短板：成对正则要求闭合标签）', () => {
        // 记录现状：无 </script> 时成对剔除正则不命中，仅剥掉开标签，脚本源码残留
        expect(extractTextFromHtml('<p>正文</p><script>evil()')).toBe('正文evil()')
    })
})
