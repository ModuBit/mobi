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
 * Tavily provider：官方 SDK（@tavily/core）—— search + extract（服务端提炼正文直出）。
 * SDK 的 search/extract 均支持 timeout（秒）；HTTP 错误 message 以状态码开头
 * （"401 Error: {...}"）、超时为 "Request timed out after N seconds."，
 * 据此映射到统一的 WebToolError 错误码。
 */
import { tavily } from '@tavily/core'
import type { WebToolProvider, WebFetchInput, WebFetchResult, WebSearchInput, WebSearchResult, WebToolProviderCredentials } from '../provider'
import { WebToolError } from '../provider'

/**
 * SDK 错误 → WebToolError 映射（message 形态以 @tavily/core 抛错点为准）：
 * - "Request timed out after N seconds." → timeout
 * - "401 Error: ..." 等状态码开头 → 429/5xx 归 upstream，其余 4xx 归 auth（凭据失效 → 提示去配置页）
 * - 其它（网络层 reject 原样抛出）→ network
 */
function mapTavilyError(error: unknown): WebToolError {
    const message = error instanceof Error ? error.message : String(error)
    if (message.startsWith('Request timed out')) {
        return new WebToolError('timeout', 'tavily', `tavily 请求超时：${message}`)
    }
    const statusMatch = /^(\d{3}) Error:/.exec(message)
    if (statusMatch) {
        const status = Number(statusMatch[1])
        const code = status === 429 || status >= 500 ? 'upstream' : 'auth'
        return new WebToolError(code, 'tavily', `tavily ${message}`)
    }
    return new WebToolError('network', 'tavily', `tavily 网络错误：${message}`)
}

export function createTavilyProvider(credentials: WebToolProviderCredentials): WebToolProvider {
    const { apiKey, timeoutMs } = credentials
    // SDK 的 timeout 单位是秒（默认 60），下限 1s
    const timeoutSeconds = Math.max(1, Math.round(timeoutMs / 1000))
    const client = tavily({ apiKey })
    return {
        id: 'tavily',
        capabilities: { search: true, fetch: true },
        async search(input: WebSearchInput): Promise<WebSearchResult[]> {
            try {
                const response = await client.search(input.query, {
                    maxResults: 10,
                    timeout: timeoutSeconds,
                    // 域名过滤透传 SDK 服务端过滤（非空才带；handler 侧 domainFilter 仍是兜底双保险）
                    ...(input.allowed_domains?.length ? { includeDomains: input.allowed_domains } : {}),
                    ...(input.blocked_domains?.length ? { excludeDomains: input.blocked_domains } : {}),
                })
                return (response.results ?? []).map((r) => ({
                    title: r.title ?? r.url ?? '',
                    url: r.url ?? '',
                    snippet: r.content ?? '',
                }))
            } catch (error) {
                throw mapTavilyError(error)
            }
        },
        async fetch(input: WebFetchInput): Promise<WebFetchResult> {
            try {
                const response = await client.extract([input.url], { timeout: timeoutSeconds })
                const content = response.results?.[0]?.rawContent
                if (!content) {
                    const failed = response.failedResults?.[0]
                    const detail = failed ? `${failed.url}（${failed.error}）` : input.url
                    throw new WebToolError('empty', 'tavily', `tavily extract 未返回内容：${detail}`)
                }
                return { content }
            } catch (error) {
                if (error instanceof WebToolError) throw error
                throw mapTavilyError(error)
            }
        },
    }
}
