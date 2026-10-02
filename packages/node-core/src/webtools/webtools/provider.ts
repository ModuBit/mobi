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

/** 对齐内置 WebSearch 入参（sdk-tools.d.ts WebSearchInput）；maxResults 为轻量调用（如 verify 连通检测）预留 */
export type WebSearchInput = {
    query: string
    allowed_domains?: string[]
    blocked_domains?: string[]
    /** 结果条数上限（provider 各自默认，如 tavily=10）；连通性验证传 1 省配额与延迟 */
    maxResults?: number
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
