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

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { createDeepSeekProvider } from '@/webtools/providers/deepseek'

const fetchMock = vi.fn()

beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
    vi.unstubAllGlobals()
})

/** 构造 JSON 响应 */
function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    })
}

describe('deepseek search（HTTP API）', () => {
    it('请求端点/鉴权/请求体 + 结果映射（summary 优先，回退 snippet）', async () => {
        fetchMock.mockResolvedValue(jsonResponse({
            results: [
                { title: '杭州天气', url: 'https://a.com/1', summary: '长摘要', snippet: '短摘要' },
                { title: '无摘要', url: 'https://b.com/2', snippet: '短摘要2' },
            ],
        }))
        const provider = createDeepSeekProvider({ apiKey: 'sk-test', timeoutMs: 15_000 })
        const results = await provider.search({ query: '杭州天气' })
        expect(results).toEqual([
            { title: '杭州天气', url: 'https://a.com/1', snippet: '长摘要' },
            { title: '无摘要', url: 'https://b.com/2', snippet: '短摘要2' },
        ])
        expect(fetchMock).toHaveBeenCalledTimes(1)
        const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit]
        expect(url).toBe('https://api.deepseek.com/v1/tools/search')
        expect(init.method).toBe('POST')
        expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test')
        expect(JSON.parse(String(init.body))).toEqual({ query: '杭州天气', count: 10 })
        expect(init.signal).toBeInstanceOf(AbortSignal)
    })

    it('maxResults 钳制到 [1, 50]（verify 传 1 省配额）', async () => {
        // 每次调用返回新的 Response（Response body 只能消费一次，mockResolvedValue 复用会报 Body is unusable）
        fetchMock.mockImplementation(async () => jsonResponse({ results: [] }))
        const provider = createDeepSeekProvider({ apiKey: 'k', timeoutMs: 15_000 })
        await provider.search({ query: 'q', maxResults: 1 })
        expect(JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body)).count).toBe(1)
        await provider.search({ query: 'q', maxResults: 999 })
        expect(JSON.parse(String((fetchMock.mock.calls[1]![1] as RequestInit).body)).count).toBe(50)
        await provider.search({ query: 'q', maxResults: 0 })
        expect(JSON.parse(String((fetchMock.mock.calls[2]![1] as RequestInit).body)).count).toBe(1)
    })

    it('域名过滤 → 官方搜索语法（site: / -site:），非法域名不注入', async () => {
        fetchMock.mockResolvedValue(jsonResponse({ results: [] }))
        const provider = createDeepSeekProvider({ apiKey: 'k', timeoutMs: 15_000 })
        await provider.search({
            query: 'DeepSeek 模型',
            allowed_domains: ['github.com', 'huggingface.co', 'bad domain!'],
            blocked_domains: ['ads.com'],
        })
        const body = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body)) as { query: string }
        expect(body.query).toBe('DeepSeek 模型 site:github.com OR site:huggingface.co -site:ads.com')
    })

    it('空结果 → 空数组', async () => {
        fetchMock.mockResolvedValue(jsonResponse({ results: [] }))
        const provider = createDeepSeekProvider({ apiKey: 'k', timeoutMs: 15_000 })
        expect(await provider.search({ query: 'x' })).toEqual([])
    })

    it('401 → code=auth（携带错误体 message）', async () => {
        fetchMock.mockResolvedValue(jsonResponse({ error: { message: 'Authentication Fails' } }, 401))
        const provider = createDeepSeekProvider({ apiKey: 'bad', timeoutMs: 15_000 })
        await expect(provider.search({ query: 'x' })).rejects.toMatchObject({
            code: 'auth',
            providerId: 'deepseek',
            message: expect.stringContaining('Authentication Fails'),
        })
    })

    it('408 / 504 → code=timeout', async () => {
        const provider = createDeepSeekProvider({ apiKey: 'k', timeoutMs: 15_000 })
        fetchMock.mockResolvedValueOnce(jsonResponse({ error: { message: 'read timeout' } }, 408))
        await expect(provider.search({ query: 'x' })).rejects.toMatchObject({ code: 'timeout' })
        fetchMock.mockResolvedValueOnce(jsonResponse({ error: { message: 'gateway timeout' } }, 504))
        await expect(provider.search({ query: 'x' })).rejects.toMatchObject({ code: 'timeout' })
    })

    it('402/403/404/429/500 → code=upstream（search 的 404 不算 empty）', async () => {
        const provider = createDeepSeekProvider({ apiKey: 'k', timeoutMs: 15_000 })
        for (const status of [402, 403, 404, 429, 500]) {
            fetchMock.mockResolvedValueOnce(jsonResponse({ error: { message: 'e' } }, status))
            await expect(provider.search({ query: 'x' })).rejects.toMatchObject({ code: 'upstream' })
        }
    })

    it('AbortSignal.timeout 触发的 TimeoutError → code=timeout', async () => {
        fetchMock.mockRejectedValue(new DOMException('The operation timed out.', 'TimeoutError'))
        const provider = createDeepSeekProvider({ apiKey: 'k', timeoutMs: 15_000 })
        await expect(provider.search({ query: 'x' })).rejects.toMatchObject({ code: 'timeout' })
    })

    it('网络层错误（fetch TypeError）→ code=network', async () => {
        fetchMock.mockRejectedValue(new TypeError('fetch failed'))
        const provider = createDeepSeekProvider({ apiKey: 'k', timeoutMs: 15_000 })
        await expect(provider.search({ query: 'x' })).rejects.toMatchObject({ code: 'network' })
    })
})

describe('deepseek fetch（HTTP API）', () => {
    it('返回 Markdown 正文', async () => {
        fetchMock.mockResolvedValue(jsonResponse({ title: 't', content: '# 正文' }))
        const provider = createDeepSeekProvider({ apiKey: 'k', timeoutMs: 15_000 })
        expect(await provider.fetch({ url: 'https://a.com', prompt: '总结' })).toEqual({ content: '# 正文' })
        const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit]
        expect(url).toBe('https://api.deepseek.com/v1/tools/fetch')
        expect(JSON.parse(String(init.body))).toEqual({ url: 'https://a.com' })
    })

    it('正文为空 → code=empty', async () => {
        fetchMock.mockResolvedValue(jsonResponse({ title: 't', content: '' }))
        const provider = createDeepSeekProvider({ apiKey: 'k', timeoutMs: 15_000 })
        await expect(provider.fetch({ url: 'https://a.com', prompt: 'x' })).rejects.toMatchObject({
            code: 'empty',
            providerId: 'deepseek',
        })
    })

    it('404 → code=empty（未取到可用正文）；403 → code=upstream（安全策略拒绝）', async () => {
        const provider = createDeepSeekProvider({ apiKey: 'k', timeoutMs: 15_000 })
        fetchMock.mockResolvedValueOnce(jsonResponse({ error: { message: 'not found' } }, 404))
        await expect(provider.fetch({ url: 'https://a.com', prompt: 'x' })).rejects.toMatchObject({ code: 'empty' })
        fetchMock.mockResolvedValueOnce(jsonResponse({ error: { message: 'blocked' } }, 403))
        await expect(provider.fetch({ url: 'https://a.com', prompt: 'x' })).rejects.toMatchObject({ code: 'upstream' })
    })
})
