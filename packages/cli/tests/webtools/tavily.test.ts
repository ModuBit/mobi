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
import { createTavilyProvider } from '@/webtools/providers/tavily'

afterEach(() => vi.unstubAllGlobals())

const okSearch = {
    ok: true,
    json: async () => ({
        results: [
            { title: '杭州天气', url: 'https://a.com/1', content: '晴 35 度' },
            { title: 'Ad', url: 'https://ads.com/x', content: '广告' },
        ],
    }),
}

describe('tavily search', () => {
    it('返回统一格式结果', async () => {
        const fetchMock = vi.fn().mockResolvedValue(okSearch)
        vi.stubGlobal('fetch', fetchMock)
        const provider = createTavilyProvider({ apiKey: 'k', timeoutMs: 1000 })
        const results = await provider.search({ query: '杭州天气' })
        expect(results).toHaveLength(2)
        expect(results[0]).toEqual({ title: '杭州天气', url: 'https://a.com/1', snippet: '晴 35 度' })
        const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
        expect(body.api_key).toBe('k')
        expect(body.query).toBe('杭州天气')
    })
    it('4xx → 抛 WebToolError（code=auth）', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, statusText: 'Unauthorized' }))
        const provider = createTavilyProvider({ apiKey: 'bad', timeoutMs: 1000 })
        await expect(provider.search({ query: 'x' })).rejects.toMatchObject({ code: 'auth', providerId: 'tavily' })
    })
    it('5xx → 抛 WebToolError（code=upstream）', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502, statusText: 'Bad Gateway' }))
        const provider = createTavilyProvider({ apiKey: 'k', timeoutMs: 1000 })
        await expect(provider.search({ query: 'x' })).rejects.toMatchObject({ code: 'upstream', providerId: 'tavily' })
    })
    it('429 → 抛 WebToolError（code=upstream，限流非凭据问题）', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429, statusText: 'Too Many Requests' }))
        const provider = createTavilyProvider({ apiKey: 'k', timeoutMs: 1000 })
        await expect(provider.search({ query: 'x' })).rejects.toMatchObject({ code: 'upstream', providerId: 'tavily' })
    })
    it('200 但响应非 JSON → 抛 WebToolError（code=upstream）', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => { throw new SyntaxError('Unexpected token < in JSON') } }))
        const provider = createTavilyProvider({ apiKey: 'k', timeoutMs: 1000 })
        await expect(provider.search({ query: 'x' })).rejects.toMatchObject({ code: 'upstream', providerId: 'tavily' })
    })
    it('fetch 直接 reject → 抛 WebToolError（code=network）', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))
        const provider = createTavilyProvider({ apiKey: 'k', timeoutMs: 1000 })
        await expect(provider.search({ query: 'x' })).rejects.toMatchObject({ code: 'network', providerId: 'tavily' })
    })
    it('响应畸形（results 非数组）→ 抛 WebToolError（code=upstream）', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ results: 'oops' }) }))
        const provider = createTavilyProvider({ apiKey: 'k', timeoutMs: 1000 })
        await expect(provider.search({ query: 'x' })).rejects.toMatchObject({ code: 'upstream', providerId: 'tavily' })
    })
    it('超时 → 抛 WebToolError（code=timeout）', async () => {
        vi.stubGlobal('fetch', vi.fn().mockImplementation((_u: string, init: RequestInit) =>
            new Promise((_res, rej) => {
                // 兜底 2000ms：远大于 provider 的 30ms 超时又留足与 vitest 默认 5s testTimeout 的余量，避免 flaky
                const t = setTimeout(() => rej(new DOMException('Aborted', 'AbortError')), 2000)
                init?.signal?.addEventListener('abort', () => { clearTimeout(t); rej(new DOMException('Aborted', 'AbortError')) })
            }),
        ))
        const provider = createTavilyProvider({ apiKey: 'k', timeoutMs: 30 })
        await expect(provider.search({ query: 'x' })).rejects.toMatchObject({ code: 'timeout', providerId: 'tavily' })
    })
    it('allowed/blocked domains → 映射 include_domains/exclude_domains 且仅在非空时携带', async () => {
        const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ results: [] }) })
        vi.stubGlobal('fetch', fetchMock)
        const provider = createTavilyProvider({ apiKey: 'k', timeoutMs: 1000 })
        await provider.search({ query: 'x', allowed_domains: ['a.com'], blocked_domains: ['ads.com'] })
        const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
        expect(body.include_domains).toEqual(['a.com'])
        expect(body.exclude_domains).toEqual(['ads.com'])
        // 非空才携带：不传时 body 里不该出现这两个字段
        await provider.search({ query: 'x' })
        const body2 = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string)
        expect(body2).not.toHaveProperty('include_domains')
        expect(body2).not.toHaveProperty('exclude_domains')
    })
    it('空结果 → 返回空数组', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ results: [] }) }))
        const provider = createTavilyProvider({ apiKey: 'k', timeoutMs: 1000 })
        expect(await provider.search({ query: 'x' })).toEqual([])
    })
})

describe('tavily fetch（extract）', () => {
    it('返回提炼正文', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ results: [{ url: 'https://a.com', raw_content: '正文内容' }] }),
        }))
        const provider = createTavilyProvider({ apiKey: 'k', timeoutMs: 1000 })
        const result = await provider.fetch({ url: 'https://a.com', prompt: '总结' })
        expect(result.content).toContain('正文内容')
    })
    it('extract 无结果 → 抛 WebToolError（code=empty）', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ results: [] }) }))
        const provider = createTavilyProvider({ apiKey: 'k', timeoutMs: 1000 })
        await expect(provider.fetch({ url: 'https://a.com', prompt: 'x' })).rejects.toMatchObject({ code: 'empty', providerId: 'tavily' })
    })
})
