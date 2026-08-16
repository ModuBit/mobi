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
 * Tavily provider：search（/search）+ fetch（/extract，直接返回提炼文本）。
 * API 文档：https://docs.tavily.com（实现以官方文档为准）
 */
import {
    fetchJson,
    WebToolError,
    type WebToolProvider,
    type WebToolProviderCredentials,
    type WebFetchInput,
    type WebFetchResult,
    type WebSearchInput,
    type WebSearchResult,
} from '../provider'

const SEARCH_URL = 'https://api.tavily.com/search'
const EXTRACT_URL = 'https://api.tavily.com/extract'

export function createTavilyProvider(credentials: WebToolProviderCredentials): WebToolProvider {
    const { apiKey, timeoutMs } = credentials
    return {
        id: 'tavily',
        capabilities: { search: true, fetch: true },
        async search(input: WebSearchInput): Promise<WebSearchResult[]> {
            // 域名过滤映射到 Tavily 原生参数，仅在非空时加入 body
            const domains: { include_domains?: string[]; exclude_domains?: string[] } = {}
            if (input.allowed_domains?.length) domains.include_domains = input.allowed_domains
            if (input.blocked_domains?.length) domains.exclude_domains = input.blocked_domains
            const body = await fetchJson('tavily', SEARCH_URL, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ api_key: apiKey, query: input.query, max_results: 10, ...domains }),
            }, timeoutMs) as { results?: unknown }
            if (!Array.isArray(body.results)) {
                // 畸形响应当上游故障
                throw new WebToolError('upstream', 'tavily', `tavily search 响应格式异常：results 非数组`)
            }
            return (body.results as Array<{ title?: string; url?: string; content?: string }>).map((r) => ({
                title: r.title ?? r.url ?? '',
                url: r.url ?? '',
                snippet: r.content ?? '',
            }))
        },
        async fetch(input: WebFetchInput): Promise<WebFetchResult> {
            const body = await fetchJson('tavily', EXTRACT_URL, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ api_key: apiKey, urls: [input.url] }),
            }, timeoutMs) as { results?: unknown }
            if (!Array.isArray(body.results)) {
                throw new WebToolError('upstream', 'tavily', `tavily extract 响应格式异常：results 非数组`)
            }
            const content = (body.results as Array<{ url?: string; raw_content?: string }>)[0]?.raw_content
            if (!content) {
                throw new WebToolError('empty', 'tavily', `tavily extract 未返回内容：${input.url}`)
            }
            return { content }
        },
    }
}
