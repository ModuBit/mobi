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

import { describe, expect, it } from 'vitest'
import { resolveSearchProvider, resolveFetchProvider, NO_PROVIDER_MESSAGE, domainFilter } from '@/webtools/registry'

describe('resolveSearchProvider / resolveFetchProvider', () => {
    it('未配置 → null（走默认空实现）', () => {
        expect(resolveSearchProvider({})).toBeNull()
        expect(resolveFetchProvider({})).toBeNull()
    })
    it('选中的 provider 未启用或凭据缺失 → null', () => {
        expect(resolveSearchProvider({
            searchProviderId: 'tavily',
            providers: [{ id: 'tavily', enabled: false, credentials: { apiKey: 'k' }, timeoutMs: 1000 }],
        })).toBeNull()
        expect(resolveSearchProvider({
            searchProviderId: 'tavily',
            providers: [{ id: 'tavily', enabled: true, credentials: {}, timeoutMs: 1000 }],
        })).toBeNull()
    })
    it('配置齐全 → 对应 provider 实例', () => {
        const provider = resolveSearchProvider({
            searchProviderId: 'tavily',
            providers: [{ id: 'tavily', enabled: true, credentials: { apiKey: 'k' }, timeoutMs: 1000 }],
        })
        expect(provider?.id).toBe('tavily')
    })
    it('fetch 未单独配置时回退 searchProviderId', () => {
        const provider = resolveFetchProvider({
            searchProviderId: 'tavily',
            providers: [{ id: 'tavily', enabled: true, credentials: { apiKey: 'k' }, timeoutMs: 1000 }],
        })
        expect(provider?.id).toBe('tavily')
    })
    it('选中的 provider 无对应配置条目 → null（schema 容忍的中间态）', () => {
        expect(resolveSearchProvider({
            searchProviderId: 'tavily',
            providers: [],
        })).toBeNull()
    })
    it('NO_PROVIDER_MESSAGE 包含配置指引', () => {
        expect(NO_PROVIDER_MESSAGE).toContain('设置')
    })
})

describe('domainFilter', () => {
    const results = [
        { title: 'a', url: 'https://a.com/1', snippet: '' },
        { title: 'b', url: 'https://b.com/2', snippet: '' },
    ]
    it('allowed_domains 只留白名单域名', () => {
        expect(domainFilter(results, { allowed_domains: ['a.com'] })).toHaveLength(1)
    })
    it('blocked_domains 剔除黑名单域名', () => {
        expect(domainFilter(results, { blocked_domains: ['b.com'] })).toHaveLength(1)
    })
    it('子域名命中（a.com 匹配 sub.a.com）', () => {
        const sub = [{ title: 's', url: 'https://sub.a.com/x', snippet: '' }]
        expect(domainFilter(sub, { allowed_domains: ['a.com'] })).toHaveLength(1)
    })
    it('无过滤条件原样返回', () => {
        expect(domainFilter(results, {})).toHaveLength(2)
    })
})
