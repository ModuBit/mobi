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
 * 自定义 Web 工具配置协议（跨 hub/web/cli 共享）。
 *
 * 用途：CLI 侧通过 SDK toolAliases 把内置 WebSearch/WebFetch 重定向到自建 provider
 * 实现（如 Tavily、博查）。配置明文存于 `~/.mobi/settings.json` 的 `webTools` 段，
 * 回显给 Web 前端时必须经 `redactWebToolsConfig` 脱敏，只透露"设没设"不回传值。
 */
import { z } from 'zod'

/** 可选 provider 清单：新增 provider 时在此登记 */
export const WEB_TOOL_PROVIDER_IDS = ['tavily'] as const
export type WebToolProviderId = (typeof WEB_TOOL_PROVIDER_IDS)[number]

export const WebToolProviderSettingsSchema = z.object({
    id: z.enum(WEB_TOOL_PROVIDER_IDS),
    enabled: z.boolean(),
    /** provider 凭据（apiKey 等），明文存本机 settings.json（与 cliApiToken 同级敏感度） */
    credentials: z.record(z.string(), z.string()),
    /** 单次调用超时（毫秒） */
    timeoutMs: z.number().int().positive().max(120_000).default(15_000),
})

export const WebToolsConfigSchema = z
    .object({
        /** 当前搜索 provider（选择的有效性由 CLI 写入侧校验：写入时拒绝指向未启用/凭据缺失的条目，schema 容忍中间态） */
        searchProviderId: z.enum(WEB_TOOL_PROVIDER_IDS).optional(),
        /** 当前抓取 provider（可与搜索不同；有效性同样由 CLI 写入侧校验） */
        fetchProviderId: z.enum(WEB_TOOL_PROVIDER_IDS).optional(),
        providers: z.array(WebToolProviderSettingsSchema).optional(),
    })
    .superRefine((config, ctx) => {
        // 同一 provider 只允许一条配置，重复 id 会使"当前选择指向哪条"产生歧义
        if (
            config.providers &&
            new Set(config.providers.map((provider) => provider.id)).size !== config.providers.length
        ) {
            ctx.addIssue({
                code: 'custom',
                path: ['providers'],
                message: 'providers 中存在重复的 provider id，同一 provider 只允许配置一条',
            })
        }
    })
export type WebToolsConfig = z.infer<typeof WebToolsConfigSchema>
export type WebToolProviderSettings = z.infer<typeof WebToolProviderSettingsSchema>

/** 凭据脱敏回显结构：只告诉前端"设没设"，不回传值 */
export type RedactedCredentials = Record<string, { set: boolean }>
export type RedactedWebToolsConfig = Omit<WebToolsConfig, 'providers'> & {
    providers?: Array<Omit<WebToolProviderSettings, 'credentials'> & { credentials: RedactedCredentials }>
}

/** web 配置页回显用：凭据值替换为 { set: true/false } */
export function redactWebToolsConfig(config: WebToolsConfig): RedactedWebToolsConfig {
    const { providers, ...rest } = config
    return {
        ...rest,
        ...(providers
            ? {
                  providers: providers.map(({ credentials, ...provider }) => ({
                      ...provider,
                      credentials: Object.fromEntries(
                          credentialKeysFor(provider.id).map((key) => [key, { set: Boolean(credentials[key]) }]),
                      ),
                  })),
              }
            : {}),
    }
}

/** 每个 provider 需要的凭据字段声明（校验与脱敏共用） */
export function credentialKeysFor(id: WebToolProviderId): string[] {
    switch (id) {
        case 'tavily':
            return ['apiKey']
    }
}
