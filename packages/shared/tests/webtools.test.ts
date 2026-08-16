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

/** web 工具配置协议类型与凭据脱敏测试 */
import { describe, expect, it } from 'vitest'
import {
    WebToolsConfigSchema,
    WebToolsConfigSubmissionSchema,
    maskCredential,
    redactWebToolsConfig,
    normalizeWebToolsConfig,
} from '../src/webtools'

describe('WebToolsConfigSchema', () => {
    it('空对象合法（未配置态）', () => {
        expect(WebToolsConfigSchema.parse({})).toEqual({})
    })

    it('完整配置通过并带默认值', () => {
        const parsed = WebToolsConfigSchema.parse({
            searchProviderId: 'tavily',
            fetchProviderId: 'tavily',
            providers: [{ id: 'tavily', enabled: true, credentials: { apiKey: 'tvly-x' } }],
        })
        expect(parsed.providers?.[0]?.timeoutMs).toBe(15000)
    })

    it('未知 provider id 整条被拒绝（ZodError）', () => {
        // Zod 的 strip 未知 key 是对象级行为；id 枚举校验失败会抛 ZodError 而非 strip 该条目
        expect(() => WebToolsConfigSchema.parse({ providers: [{ id: 'nope', enabled: true }] })).toThrow()
    })

    it('重复 provider id 被拒', () => {
        expect(() =>
            WebToolsConfigSchema.parse({
                providers: [
                    { id: 'tavily', enabled: true, credentials: {} },
                    { id: 'tavily', enabled: false, credentials: {} },
                ],
            }),
        ).toThrow('重复的 provider id')
    })
})

describe('redactWebToolsConfig', () => {
    it('凭据脱敏为在场性布尔 + 掩码 preview', () => {
        const redacted = redactWebToolsConfig(
            WebToolsConfigSchema.parse({
                providers: [{ id: 'tavily', enabled: true, credentials: { apiKey: 'secret' } }],
            }),
        )
        expect(redacted.providers?.[0]?.credentials).toEqual({ apiKey: { set: true, preview: '******' } })
    })

    it('未设置的凭据字段显示 set: false', () => {
        const redacted = redactWebToolsConfig(
            WebToolsConfigSchema.parse({
                providers: [{ id: 'tavily', enabled: true, credentials: {} }],
            }),
        )
        expect(redacted.providers?.[0]?.credentials).toEqual({ apiKey: { set: false } })
    })

    it('无 providers 时脱敏结果也不含 providers', () => {
        const redacted = redactWebToolsConfig(WebToolsConfigSchema.parse({}))
        expect(redacted.providers).toBeUndefined()
    })
})

describe('normalizeWebToolsConfig（存量归一）', () => {
    it('合法配置原样通过', () => {
        const config = { searchProviderId: 'tavily', providers: [{ id: 'tavily', enabled: true, credentials: { apiKey: 'k' } }] }
        expect(normalizeWebToolsConfig(config)).toEqual(WebToolsConfigSchema.parse(config))
    })

    it('残留已下线 provider 条目（如 bocha）→ 剔除该条目，保留其余合法配置', () => {
        const normalized = normalizeWebToolsConfig({
            searchProviderId: 'tavily',
            providers: [
                { id: 'tavily', enabled: true, credentials: { apiKey: 'k' } },
                { id: 'bocha', enabled: true, credentials: { apiKey: 'b' } },
            ],
        })
        expect(normalized.providers).toHaveLength(1)
        expect(normalized.providers?.[0]?.id).toBe('tavily')
        expect(normalized.searchProviderId).toBe('tavily')
    })

    it('选择指向被剔除条目 → 清空该选择（schema 容忍中间态，路由层返回 null）', () => {
        const normalized = normalizeWebToolsConfig({
            searchProviderId: 'bocha',
            fetchProviderId: 'tavily',
            providers: [
                { id: 'bocha', enabled: true, credentials: {} },
                { id: 'tavily', enabled: true, credentials: { apiKey: 'k' } },
            ],
        })
        expect(normalized.searchProviderId).toBeUndefined()
        expect(normalized.fetchProviderId).toBe('tavily')
        expect(normalized.providers).toHaveLength(1)
    })

    it('重复 provider id → 保留首条（对齐 schema 唯一性语义）', () => {
        const normalized = normalizeWebToolsConfig({
            providers: [
                { id: 'tavily', enabled: true, credentials: { apiKey: 'first' } },
                { id: 'tavily', enabled: false, credentials: {} },
            ],
        })
        expect(normalized.providers).toHaveLength(1)
        expect(normalized.providers?.[0]?.credentials.apiKey).toBe('first')
    })

    it('选择指向未知 provider（providers 段合法）→ 清空选择、保留条目', () => {
        const normalized = normalizeWebToolsConfig({
            searchProviderId: 'nope',
            providers: [{ id: 'tavily', enabled: true, credentials: { apiKey: 'k' } }],
        })
        expect(normalized.searchProviderId).toBeUndefined()
        expect(normalized.providers?.[0]?.id).toBe('tavily')
    })

    it('垃圾输入（字符串/null/undefined）→ 空配置', () => {
        expect(normalizeWebToolsConfig('nope')).toEqual({})
        expect(normalizeWebToolsConfig(null)).toEqual({})
        expect(normalizeWebToolsConfig(undefined)).toEqual({})
    })

    it('providers 全部非法 → 空配置', () => {
        expect(normalizeWebToolsConfig({ providers: [{ id: 'bocha', enabled: true }, 'garbage'] })).toEqual({})
    })
})

describe('maskCredential', () => {
    it('len ≥ 12：前 5 + 6 星 + 后 2', () => {
        expect(maskCredential('tvly-abcdEFGH1234')).toBe('tvly-******34')
    })
    it('8 ≤ len < 12：前 3 + 4 星 + 后 2', () => {
        expect(maskCredential('abcdefghij')).toBe('abc****ij')
    })
    it('len < 8：全掩码', () => {
        expect(maskCredential('abc')).toBe('***')
        expect(maskCredential('abcdefg')).toBe('*******')
    })
})

describe('WebToolsConfigSubmissionSchema（提交方向：credentials 值 string | null）', () => {
    it('null（清除）/ string（覆盖）均合法；非字符串非 null 拒绝', () => {
        expect(WebToolsConfigSubmissionSchema.safeParse({
            providers: [{ id: 'tavily', enabled: true, credentials: { apiKey: null } }],
        }).success).toBe(true)
        expect(WebToolsConfigSubmissionSchema.safeParse({
            providers: [{ id: 'tavily', enabled: true, credentials: { apiKey: 'new-key' } }],
        }).success).toBe(true)
        expect(WebToolsConfigSubmissionSchema.safeParse({
            providers: [{ id: 'tavily', enabled: true, credentials: { apiKey: 123 } }],
        }).success).toBe(false)
    })
})

describe('redactWebToolsConfig preview 生成', () => {
    it('已设置凭据带 preview（掩码），未设置 { set: false } 无 preview', () => {
        const redacted = redactWebToolsConfig({
            searchProviderId: 'tavily',
            providers: [
                { id: 'tavily', enabled: true, credentials: { apiKey: 'tvly-abcdef123456' }, timeoutMs: 15_000 },
            ],
        })
        expect(redacted.providers?.[0]?.credentials.apiKey).toEqual({ set: true, preview: 'tvly-******56' })
    })
    it('未设置凭据：{ set: false } 无 preview', () => {
        const redacted = redactWebToolsConfig({ providers: [{ id: 'tavily', enabled: true, credentials: {}, timeoutMs: 15_000 }] })
        expect(redacted.providers?.[0]?.credentials.apiKey).toEqual({ set: false })
    })
})
