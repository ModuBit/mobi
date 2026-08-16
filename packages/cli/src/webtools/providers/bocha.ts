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
 * 博查 provider：search 走博查 AI 搜索 API；fetch 直连抓取 + 简易正文提取。
 * fetch 加工策略（provider 内部决定）：博查无提炼能力 → html 剥离提取正文；
 * v1 用启发式（去 script/style/nav + 剥标签 + 解实体），质量不够再引入 linkedom+turndown。
 */
import type {
    WebToolProvider,
    WebFetchInput,
    WebFetchResult,
    WebSearchInput,
    WebSearchResult,
    WebToolProviderCredentials,
} from '../provider'
import { fetchJson, httpStatusToErrorCode, WebToolError } from '../provider'

const SEARCH_URL = 'https://api.bochaai.com/v1/web-search'
/** 正文上限（字符）：对齐内置 WebFetch 的量级，防长页撑爆上下文 */
const MAX_CONTENT_CHARS = 48_000

export function createBochaProvider(credentials: WebToolProviderCredentials): WebToolProvider {
    const { apiKey, timeoutMs } = credentials
    return {
        id: 'bocha',
        capabilities: { search: true, fetch: true },
        async search(input: WebSearchInput): Promise<WebSearchResult[]> {
            const body = await fetchJson('bocha', SEARCH_URL, {
                method: 'POST',
                headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
                body: JSON.stringify({ query: input.query, freshness: 'noLimit', summary: true, count: 10 }),
            }, timeoutMs) as { code?: number; msg?: string; data?: { webPages?: { value?: Array<{ name?: string; url?: string; snippet?: string; summary?: string }> } } }
            if (body.code !== 200) {
                // 博查用 code 表达业务错误：401/403 类视作凭据问题，其余（含 429 限流）为上游问题
                const isAuth = body.code === 401 || body.code === 403
                throw new WebToolError(isAuth ? 'auth' : 'upstream', 'bocha', `bocha ${body.code}: ${body.msg ?? ''}`)
            }
            const values = body.data?.webPages?.value
            if (!Array.isArray(values)) return []
            return values.map((r) => ({
                title: r.name ?? r.url ?? '',
                url: r.url ?? '',
                snippet: r.snippet ?? r.summary ?? '',
            }))
        },
        async fetch(input: WebFetchInput): Promise<WebFetchResult> {
            // 直连抓取不能走 fetchJson（要 text() 不是 json()），自带超时与错误映射
            const controller = new AbortController()
            const timer = setTimeout(() => controller.abort(), timeoutMs)
            try {
                const response = await fetch(input.url, { signal: controller.signal, redirect: 'follow' })
                if (!response.ok) {
                    throw new WebToolError(httpStatusToErrorCode(response.status), 'bocha', `bocha HTTP ${response.status} ${response.statusText}：${input.url}`)
                }
                const contentType = response.headers.get('content-type') ?? 'text/plain'
                const raw = await response.text()
                const content = contentType.includes('html') ? extractTextFromHtml(raw) : raw
                if (!content.trim()) {
                    throw new WebToolError('empty', 'bocha', `bocha 页面无可提取正文：${input.url}`)
                }
                if (content.length <= MAX_CONTENT_CHARS) return { content }
                return { content: `${content.slice(0, MAX_CONTENT_CHARS)}\n\n[内容过长，已截断至 ${MAX_CONTENT_CHARS} 字符]` }
            } catch (error) {
                if (error instanceof WebToolError) throw error
                if (error instanceof Error && error.name === 'AbortError') {
                    throw new WebToolError('timeout', 'bocha', `bocha 抓取超时（${timeoutMs}ms）：${input.url}`)
                }
                throw new WebToolError('network', 'bocha', `bocha 网络错误：${error instanceof Error ? error.message : String(error)}`)
            } finally {
                clearTimeout(timer)
            }
        },
    }
}

/** 简易 html 正文提取：去 script/style/nav/header/footer → 剥标签 → 解实体 → 压空白 */
export function extractTextFromHtml(html: string): string {
    return html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<(nav|header|footer|aside)[\s\S]*?<\/\1>/gi, '')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n\s*\n+/g, '\n\n')
        .trim()
}
