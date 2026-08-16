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
 * provider 路由：按当前配置解析 search/fetch provider。
 * 对模型暴露的工具永远固定（web_search/web_fetch），provider 切换完全封装在此。
 * 无可用 provider → null，由工具 handler 返回 NO_PROVIDER_MESSAGE（默认空实现）。
 */
import type { WebToolsConfig } from '@mobi/shared'
import { credentialKeysFor } from '@mobi/shared'
import type { WebToolProvider, WebSearchInput, WebSearchResult } from './provider'
import { createTavilyProvider } from './providers/tavily'

/** 无可用 provider 时的兜底错误文案（agent loop 不中断，模型可告知用户） */
export const NO_PROVIDER_MESSAGE = 'mobi web 工具未配置可用的 provider。请到 mobi Web 设置页「Web 工具」中配置并启用至少一个搜索/抓取 provider（如 Tavily）。'

function createProvider(id: string, credentials: { apiKey: string; timeoutMs: number }): WebToolProvider {
    switch (id) {
        case 'tavily': return createTavilyProvider(credentials)
        default: throw new Error(`未知 web 工具 provider：${id}`)
    }
}

function resolve(config: WebToolsConfig, selectedId: string | undefined): WebToolProvider | null {
    if (!selectedId) return null
    const settings = config.providers?.find((p) => p.id === selectedId)
    if (!settings || !settings.enabled) return null
    const requiredKeys = credentialKeysFor(settings.id)
    const missing = requiredKeys.filter((key) => !settings.credentials[key])
    if (missing.length > 0) return null
    // 不变量：当前所有 provider 均为 apiKey 单键凭据（credentialKeysFor × WebToolProviderCredentials 的隐式契约）；
    // 出现多凭据 provider 时需将 credentials 整包下传并扩展该类型
    return createProvider(settings.id, { apiKey: settings.credentials[requiredKeys[0]]!, timeoutMs: settings.timeoutMs })
}

export function resolveSearchProvider(config: WebToolsConfig): WebToolProvider | null {
    return resolve(config, config.searchProviderId)
}

export function resolveFetchProvider(config: WebToolsConfig): WebToolProvider | null {
    return resolve(config, config.fetchProviderId ?? config.searchProviderId)
}

/** 内置 WebSearch 的 allowed_domains/blocked_domains 过滤（统一在此做，provider 不感知；Tavily 侧另有服务端透传双保险） */
export function domainFilter(
    results: WebSearchResult[],
    input: Pick<WebSearchInput, 'allowed_domains' | 'blocked_domains'>,
): WebSearchResult[] {
    const hostOf = (url: string): string => {
        try { return new URL(url).hostname } catch { return '' }
    }
    return results.filter((r) => {
        const host = hostOf(r.url)
        if (input.allowed_domains?.length && !input.allowed_domains.some((d) => host === d || host.endsWith(`.${d}`))) return false
        if (input.blocked_domains?.length && input.blocked_domains.some((d) => host === d || host.endsWith(`.${d}`))) return false
        return true
    })
}
