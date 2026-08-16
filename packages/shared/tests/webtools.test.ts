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

/** web 工具配置协议类型与凭据脱敏测试（bun:test） */
import { describe, expect, it } from 'vitest'
import { WebToolsConfigSchema, redactWebToolsConfig } from '../src/webtools'

describe('WebToolsConfigSchema', () => {
    it('空对象合法（未配置态）', () => {
        expect(WebToolsConfigSchema.parse({})).toEqual({})
    })

    it('完整配置通过并带默认值', () => {
        const parsed = WebToolsConfigSchema.parse({
            searchProviderId: 'tavily',
            fetchProviderId: 'bocha',
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
    it('凭据脱敏为 has 布尔', () => {
        const redacted = redactWebToolsConfig(
            WebToolsConfigSchema.parse({
                providers: [{ id: 'tavily', enabled: true, credentials: { apiKey: 'secret' } }],
            }),
        )
        expect(redacted.providers?.[0]?.credentials).toEqual({ apiKey: { set: true } })
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
