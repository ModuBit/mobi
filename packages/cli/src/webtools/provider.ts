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
 * web 工具 provider 抽象：search/fetch 的入参对齐 CC 内置工具，
 * 输出统一格式；fetch 的内容加工策略由各 provider 自行决定。
 */

/** 对齐内置 WebSearch 入参（sdk-tools.d.ts WebSearchInput） */
export type WebSearchInput = {
    query: string
    allowed_domains?: string[]
    blocked_domains?: string[]
}

/** 对齐内置 WebFetch 入参（sdk-tools.d.ts WebFetchInput） */
export type WebFetchInput = {
    url: string
    prompt: string
}

/** 统一搜索结果格式（title/url/snippet） */
export type WebSearchResult = {
    title: string
    url: string
    snippet: string
}

/** 统一抓取结果：content 为最终交给模型的正文 */
export type WebFetchResult = {
    content: string
}

/** provider 错误：code 驱动 handler 的错误文案分流 */
export type WebToolErrorCode = 'auth' | 'upstream' | 'timeout' | 'network' | 'empty'

export class WebToolError extends Error {
    readonly code: WebToolErrorCode
    readonly providerId: string

    constructor(code: WebToolErrorCode, providerId: string, message: string) {
        super(message)
        this.name = 'WebToolError'
        this.code = code
        this.providerId = providerId
    }
}

export type WebToolProviderCredentials = { apiKey: string; timeoutMs: number }

export interface WebToolProvider {
    readonly id: string
    readonly capabilities: { search: boolean; fetch: boolean }
    search(input: WebSearchInput): Promise<WebSearchResult[]>
    fetch(input: WebFetchInput): Promise<WebFetchResult>
}

/**
 * HTTP 状态码 → 错误 code 统一映射（fetchJson 与 provider 直连抓取共用）。
 *
 * 429 是限流不是凭据问题，归 upstream；其余 4xx 归 auth（凭据/参数失效 → 提示去配置页）、
 * 5xx 归 upstream（上游不稳）。
 */
export function httpStatusToErrorCode(status: number): WebToolErrorCode {
    return status === 429 || status >= 500 ? 'upstream' : 'auth'
}

/**
 * fetch 包装：超时（AbortController）+ 统一错误映射（各 provider 共用）。
 *
 * AbortError 归 timeout、SyntaxError（非 JSON）归 upstream、其余归 network。
 */
export async function fetchJson(
    providerId: string,
    url: string,
    init: RequestInit,
    timeoutMs: number,
): Promise<unknown> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
        const response = await fetch(url, { ...init, signal: controller.signal })
        if (!response.ok) {
            throw new WebToolError(httpStatusToErrorCode(response.status), providerId, `${providerId} HTTP ${response.status} ${response.statusText}`)
        }
        return await response.json()
    } catch (error) {
        if (error instanceof WebToolError) throw error
        if (error instanceof SyntaxError) {
            // 网络是通的、上游返回了非 JSON（如 HTML 错误页）→ 上游故障
            throw new WebToolError('upstream', providerId, `${providerId} 响应非 JSON：${error.message}`)
        }
        if (error instanceof Error && error.name === 'AbortError') {
            throw new WebToolError('timeout', providerId, `${providerId} 请求超时（${timeoutMs}ms）`)
        }
        throw new WebToolError('network', providerId, `${providerId} 网络错误：${error instanceof Error ? error.message : String(error)}`)
    } finally {
        clearTimeout(timer)
    }
}
