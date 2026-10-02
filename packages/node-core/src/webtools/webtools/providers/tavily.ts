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
 * SDK 的 search/extract 均支持 timeout（秒）；错误形态以 SDK 抛错点为准，
 * 据此映射到统一的 WebToolError 错误码。
 */
import { tavily, TavilyKeylessLimitError } from '@tavily/core'
import type { WebToolProvider, WebFetchInput, WebFetchResult, WebSearchInput, WebSearchResult, WebToolProviderCredentials } from '../provider'
import { WebToolError } from '../provider'

/**
 * SDK 错误 → WebToolError 映射（形态以 @tavily/core dist 抛错点为准）：
 * - "Request timed out after N seconds." → timeout
 * - TavilyKeylessLimitError（keyless 配额封顶）→ upstream
 * - 非标准错误体（detail.error 缺失）带状态码前缀 "401 Error: {...}" → 401/403 归 auth，其余归 upstream
 * - 标准错误体 {"detail":{"error":"Invalid API key"}} 抛出的 message 只有文本、无状态码 →
 *   凭据类文案（api key/unauthorized/forbidden）归 auth，其余归 upstream
 * - "An unexpected error occurred ..."（SDK 包装的网络层 reject）→ network
 */
function mapTavilyError(error: unknown): WebToolError {
    if (error instanceof TavilyKeylessLimitError) {
        return new WebToolError('upstream', 'tavily', `tavily 配额受限：${error.message}`)
    }
    const message = error instanceof Error ? error.message : String(error)
    if (message.startsWith('Request timed out')) {
        return new WebToolError('timeout', 'tavily', `tavily 请求超时：${message}`)
    }
    const statusMatch = /^(\d{3}) Error:/.exec(message)
    if (statusMatch) {
        // 401/403 是凭据问题（提示去配置页）；400 参数错、429 限流、5xx 服务端 → upstream
        const status = Number(statusMatch[1])
        const code = status === 401 || status === 403 ? 'auth' : 'upstream'
        return new WebToolError(code, 'tavily', `tavily ${message}`)
    }
    if (message.startsWith('An unexpected error occurred')) {
        return new WebToolError('network', 'tavily', `tavily 网络错误：${message}`)
    }
    if (/api\s*key|unauthorized|forbidden/i.test(message)) {
        return new WebToolError('auth', 'tavily', `tavily ${message}`)
    }
    return new WebToolError('upstream', 'tavily', `tavily 服务错误：${message}`)
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
                    maxResults: input.maxResults ?? 10,
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
