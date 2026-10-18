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
 * DeepSeek provider：官方 Search/Fetch HTTP API（api.deepseek.com/v1/tools/{search,fetch}），
 * 原生 fetch 直连、无 SDK。鉴权与错误体都走 OpenAI 兼容形态。
 *
 * 结果映射：snippet 优先取 summary（600~800 字，官方定位为「给模型阅读」），
 * 缺省回退 snippet（短摘要）、再回退 content；搜索默认不取正文（need_content=false）。
 * 域名过滤除 registry 侧 domainFilter 兜底外，另按官方搜索语法拼 site:/-site: 双保险。
 */
import type {
    WebFetchInput,
    WebFetchResult,
    WebSearchInput,
    WebSearchResult,
    WebToolErrorCode,
    WebToolProvider,
    WebToolProviderCredentials,
} from '../provider'
import { WebToolError } from '../provider'

const BASE_URL = 'https://api.deepseek.com'
const DEFAULT_RESULT_COUNT = 10
const MAX_RESULT_COUNT = 50

type SearchResponse = {
    results?: Array<{
        title?: string
        url?: string
        snippet?: string
        summary?: string
        content?: string
    }>
}

type FetchResponse = { title?: string; content?: string }

/** 错误体（OpenAI 兼容）：{ error: { message, type, param, code } } */
async function readErrorDetail(response: Response): Promise<string> {
    try {
        const body = (await response.json()) as { error?: { message?: string } }
        if (body?.error?.message) return body.error.message
    } catch {
        // 非 JSON 错误体 → 退回状态文本
    }
    return response.statusText || 'unknown error'
}

/**
 * HTTP 状态码 → 统一错误码（语义见官方错误表）：
 * - 401 Key 缺失/无效 → auth
 * - 408（读请求体超时）/ 504（下游超时）→ timeout
 * - 404 仅 fetch 语义是「未取到可用正文」→ empty；search 的 404 归 upstream
 * - 400 参数 / 402 余额 / 403 安全策略 / 429 限流 / 5xx → upstream
 */
function mapStatus(status: number, kind: 'search' | 'fetch'): WebToolErrorCode {
    if (status === 401) return 'auth'
    if (status === 408 || status === 504) return 'timeout'
    if (status === 404 && kind === 'fetch') return 'empty'
    return 'upstream'
}

/** AbortSignal.timeout 抛 TimeoutError；部分运行时/环境退化为 AbortError */
function isTimeoutError(error: unknown): boolean {
    if (typeof error !== 'object' || error === null || !('name' in error)) return false
    const name = String((error as { name: unknown }).name)
    return name === 'TimeoutError' || name === 'AbortError'
}

/** POST JSON：传输层错误映射 + 非 2xx 按状态码分流；响应解析失败归 upstream */
async function postJson<T>(
    path: string,
    body: unknown,
    credentials: WebToolProviderCredentials,
    kind: 'search' | 'fetch',
): Promise<T> {
    const { apiKey, timeoutMs } = credentials
    let response: Response
    try {
        response = await fetch(`${BASE_URL}${path}`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(timeoutMs),
        })
    } catch (error) {
        if (isTimeoutError(error)) {
            throw new WebToolError('timeout', 'deepseek', `deepseek 请求超时（${timeoutMs}ms）`)
        }
        throw new WebToolError('network', 'deepseek', `deepseek 网络错误：${error instanceof Error ? error.message : String(error)}`)
    }
    if (!response.ok) {
        const detail = await readErrorDetail(response)
        throw new WebToolError(mapStatus(response.status, kind), 'deepseek', `deepseek ${response.status}：${detail}`)
    }
    try {
        return (await response.json()) as T
    } catch (error) {
        throw new WebToolError('upstream', 'deepseek', `deepseek 响应解析失败：${error instanceof Error ? error.message : String(error)}`)
    }
}

/** 结果条数钳制到官方允许区间 [1, 50]，缺省 10 */
function clampCount(maxResults?: number): number {
    if (maxResults === undefined) return DEFAULT_RESULT_COUNT
    return Math.min(MAX_RESULT_COUNT, Math.max(1, Math.floor(maxResults)))
}

/**
 * 域名过滤 → 官方搜索语法（双保险，registry 侧 domainFilter 仍是最终兜底）：
 * 白名单 `site:a OR site:b`、黑名单 `-site:x -site:y`。
 * 仅接受主机名形态的字符，防止任意串注入查询语法。
 */
function buildQuery(input: WebSearchInput): string {
    const validDomains = (list?: string[]): string[] =>
        (list ?? []).filter((domain) => /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(domain))
    const parts = [input.query]
    const allowed = validDomains(input.allowed_domains)
    if (allowed.length > 0) parts.push(allowed.map((domain) => `site:${domain}`).join(' OR '))
    const blocked = validDomains(input.blocked_domains)
    if (blocked.length > 0) parts.push(blocked.map((domain) => `-site:${domain}`).join(' '))
    return parts.join(' ')
}

export function createDeepSeekProvider(credentials: WebToolProviderCredentials): WebToolProvider {
    return {
        id: 'deepseek',
        capabilities: { search: true, fetch: true },
        async search(input: WebSearchInput): Promise<WebSearchResult[]> {
            const response = await postJson<SearchResponse>(
                '/v1/tools/search',
                { query: buildQuery(input), count: clampCount(input.maxResults) },
                credentials,
                'search',
            )
            return (response.results ?? []).map((result) => ({
                title: result.title ?? result.url ?? '',
                url: result.url ?? '',
                snippet: result.summary || result.snippet || result.content || '',
            }))
        },
        async fetch(input: WebFetchInput): Promise<WebFetchResult> {
            const response = await postJson<FetchResponse>(
                '/v1/tools/fetch',
                { url: input.url },
                credentials,
                'fetch',
            )
            if (!response.content) {
                throw new WebToolError('empty', 'deepseek', `deepseek fetch 未返回正文：${input.url}`)
            }
            return { content: response.content }
        },
    }
}
