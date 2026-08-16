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

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { TavilyKeylessLimitError } from '@tavily/core'
import { createTavilyProvider } from '@/webtools/providers/tavily'

// mock 官方 SDK：tavily 工厂返回稳定引用（search/extract 均 vi.fn）；
// 其余导出（TavilyKeylessLimitError 等）用真实实现——实现侧 instanceof 依赖同一 class
const searchMock = vi.fn()
const extractMock = vi.fn()
vi.mock('@tavily/core', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@tavily/core')>()),
    tavily: vi.fn(() => ({ search: searchMock, extract: extractMock })),
}))

beforeEach(() => {
    searchMock.mockReset()
    extractMock.mockReset()
})

describe('tavily search（官方 SDK）', () => {
    it('返回统一格式结果 + options 透传（maxResults/timeout 秒/域名过滤）', async () => {
        searchMock.mockResolvedValue({
            results: [
                { title: '杭州天气', url: 'https://a.com/1', content: '晴 35 度' },
                { title: 'Ad', url: 'https://ads.com/x', content: '广告' },
            ],
        })
        const provider = createTavilyProvider({ apiKey: 'k', timeoutMs: 15_000 })
        const results = await provider.search({
            query: '杭州天气',
            allowed_domains: ['a.com'],
            blocked_domains: ['ads.com'],
        })
        expect(results).toHaveLength(2)
        expect(results[0]).toEqual({ title: '杭州天气', url: 'https://a.com/1', snippet: '晴 35 度' })
        // SDK 调用参数：maxResults=10、timeoutMs 毫秒 → timeout 秒、域名过滤 camelCase 透传
        expect(searchMock).toHaveBeenCalledWith('杭州天气', {
            maxResults: 10,
            timeout: 15,
            includeDomains: ['a.com'],
            excludeDomains: ['ads.com'],
        })
    })
    it('域名过滤为空/缺省时不带 includeDomains/excludeDomains', async () => {
        searchMock.mockResolvedValue({ results: [] })
        const provider = createTavilyProvider({ apiKey: 'k', timeoutMs: 15_000 })
        await provider.search({ query: 'q' })
        const options = searchMock.mock.calls[0]![1] as Record<string, unknown>
        expect('includeDomains' in options).toBe(false)
        expect('excludeDomains' in options).toBe(false)
    })
    it('timeoutMs 不足 1 秒时钳到 1s', async () => {
        searchMock.mockResolvedValue({ results: [] })
        const provider = createTavilyProvider({ apiKey: 'k', timeoutMs: 30 })
        await provider.search({ query: 'q' })
        expect((searchMock.mock.calls[0]![1] as { timeout: number }).timeout).toBe(1)
    })
    it('标准错误体（401 "Invalid API key"，无状态码前缀）→ code=auth', async () => {
        // SDK handleRequestError：detail.error 存在时 throw new Error(该文本)——Tavily 标准错误体恰是这种形态
        searchMock.mockRejectedValue(new Error('Invalid API key'))
        const provider = createTavilyProvider({ apiKey: 'bad', timeoutMs: 15_000 })
        await expect(provider.search({ query: 'x' })).rejects.toMatchObject({ code: 'auth', providerId: 'tavily' })
    })
    it('非标准错误体 "401/403 Error: ..." → code=auth', async () => {
        searchMock.mockRejectedValueOnce(new Error('401 Error: {"detail":"Unauthorized"}'))
        searchMock.mockRejectedValueOnce(new Error('403 Error: {"detail":"Forbidden"}'))
        const provider = createTavilyProvider({ apiKey: 'bad', timeoutMs: 15_000 })
        await expect(provider.search({ query: 'x' })).rejects.toMatchObject({ code: 'auth' })
        await expect(provider.search({ query: 'x' })).rejects.toMatchObject({ code: 'auth' })
    })
    it('非凭据类 4xx/429/5xx 前缀形态与标准体 429 → code=upstream', async () => {
        searchMock.mockRejectedValueOnce(new Error('400 Error: {"detail":"bad request"}'))
        searchMock.mockRejectedValueOnce(new Error('429 Error: {"detail":"Rate limit"}'))
        searchMock.mockRejectedValueOnce(new Error('502 Error: {"detail":"Bad gateway"}'))
        searchMock.mockRejectedValueOnce(new Error('Rate limit exceeded')) // 标准体 429：无前缀纯文本
        const provider = createTavilyProvider({ apiKey: 'k', timeoutMs: 15_000 })
        for (let i = 0; i < 4; i++) {
            await expect(provider.search({ query: 'x' })).rejects.toMatchObject({ code: 'upstream' })
        }
    })
    it('TavilyKeylessLimitError（keyless 配额封顶）→ code=upstream', async () => {
        searchMock.mockRejectedValue(new TavilyKeylessLimitError({
            message: 'keyless limit reached', capType: 'daily', retryAfter: null, bonusEligible: false, continuationPaths: [],
        }))
        const provider = createTavilyProvider({ apiKey: 'k', timeoutMs: 15_000 })
        await expect(provider.search({ query: 'x' })).rejects.toMatchObject({ code: 'upstream', providerId: 'tavily' })
    })
    it('"Request timed out after N seconds." → code=timeout', async () => {
        searchMock.mockRejectedValue(new Error('Request timed out after 15 seconds.'))
        const provider = createTavilyProvider({ apiKey: 'k', timeoutMs: 15_000 })
        await expect(provider.search({ query: 'x' })).rejects.toMatchObject({ code: 'timeout', providerId: 'tavily' })
    })
    it('网络层错误（SDK 包装形态）→ code=network', async () => {
        searchMock.mockRejectedValue(new Error('An unexpected error occurred while making the request. Error: fetch failed'))
        const provider = createTavilyProvider({ apiKey: 'k', timeoutMs: 15_000 })
        await expect(provider.search({ query: 'x' })).rejects.toMatchObject({ code: 'network', providerId: 'tavily' })
    })
    it('空结果 → 返回空数组', async () => {
        searchMock.mockResolvedValue({ results: [] })
        const provider = createTavilyProvider({ apiKey: 'k', timeoutMs: 15_000 })
        expect(await provider.search({ query: 'x' })).toEqual([])
    })
})

describe('tavily fetch（SDK extract）', () => {
    it('返回提炼正文（rawContent）', async () => {
        extractMock.mockResolvedValue({
            results: [{ url: 'https://a.com', title: 't', rawContent: '正文内容' }],
            failedResults: [],
        })
        const provider = createTavilyProvider({ apiKey: 'k', timeoutMs: 15_000 })
        const result = await provider.fetch({ url: 'https://a.com', prompt: '总结' })
        expect(result.content).toBe('正文内容')
        expect(extractMock).toHaveBeenCalledWith(['https://a.com'], { timeout: 15 })
    })
    it('results 空 + failedResults → code=empty（含失败原因）', async () => {
        extractMock.mockResolvedValue({
            results: [],
            failedResults: [{ url: 'https://a.com', error: 'Failed to extract' }],
        })
        const provider = createTavilyProvider({ apiKey: 'k', timeoutMs: 15_000 })
        const promise = provider.fetch({ url: 'https://a.com', prompt: 'x' })
        await expect(promise).rejects.toMatchObject({ code: 'empty', providerId: 'tavily' })
    })
    it('SDK 抛错（标准体 401）→ code=auth', async () => {
        extractMock.mockRejectedValue(new Error('Invalid API key'))
        const provider = createTavilyProvider({ apiKey: 'bad', timeoutMs: 15_000 })
        await expect(provider.fetch({ url: 'https://a.com', prompt: 'x' })).rejects.toMatchObject({ code: 'auth' })
    })
})
