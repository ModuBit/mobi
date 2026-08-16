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

/** 落盘方向的裸 object（superRefine 前）——供落盘/提交两个 schema 共同派生 */
const WebToolsConfigObjectSchema = z.object({
    /** 当前搜索 provider（选择的有效性由 CLI 写入侧校验：写入时拒绝指向未启用/凭据缺失的条目，schema 容忍中间态） */
    searchProviderId: z.enum(WEB_TOOL_PROVIDER_IDS).optional(),
    /** 当前抓取 provider（可与搜索不同；有效性同样由 CLI 写入侧校验） */
    fetchProviderId: z.enum(WEB_TOOL_PROVIDER_IDS).optional(),
    providers: z.array(WebToolProviderSettingsSchema).optional(),
})

/** providers 查重校验（落盘/提交方向共用） */
const refineUniqueProviderIds = (config: { providers?: Array<{ id: string }> } | undefined, ctx: z.RefinementCtx) => {
    // 同一 provider 只允许一条配置，重复 id 会使"当前选择指向哪条"产生歧义
    if (
        config?.providers &&
        new Set(config.providers.map((provider) => provider.id)).size !== config.providers.length
    ) {
        ctx.addIssue({
            code: 'custom',
            path: ['providers'],
            message: 'providers 中存在重复的 provider id，同一 provider 只允许配置一条',
        })
    }
}

export const WebToolsConfigSchema = WebToolsConfigObjectSchema.superRefine(refineUniqueProviderIds)
export type WebToolsConfig = z.infer<typeof WebToolsConfigSchema>
export type WebToolProviderSettings = z.infer<typeof WebToolProviderSettingsSchema>

/**
 * 提交方向 schema（web → runner set 请求体）：credentials 值放宽为 string | null。
 * 在场性协议：键不在场 = 保持旧值（新 UI 未修改）；空串 = 保持旧值（旧客户端兼容）；
 * null = 清除凭据；非空 = 覆盖。落盘方向仍用 WebToolsConfigSchema（纯 string）。
 */
const WebToolProviderSubmissionSchema = WebToolProviderSettingsSchema.extend({
    credentials: z.record(z.string(), z.union([z.string(), z.null()])),
})
export const WebToolsConfigSubmissionSchema = WebToolsConfigObjectSchema.extend({
    providers: z.array(WebToolProviderSubmissionSchema).optional(),
}).superRefine(refineUniqueProviderIds)
export type WebToolsConfigSubmission = z.infer<typeof WebToolsConfigSubmissionSchema>

/** 凭据脱敏回显结构：只告诉前端"设没设"（preview 为 maskCredential 掩码产物），不回传值 */
export type RedactedCredentials = Record<string, { set: boolean; preview?: string }>
export type RedactedWebToolsConfig = Omit<WebToolsConfig, 'providers'> & {
    providers?: Array<Omit<WebToolProviderSettings, 'credentials'> & { credentials: RedactedCredentials }>
}

/**
 * 凭据掩码预览：len ≥ 12 → 前 5 + 6 星 + 后 2；8 ≤ len < 12 → 前 3 + 4 星 + 后 2；len < 8 → 全掩码。
 * 泄露面为「已登录用户在设置页查看」威胁模型可接受（对齐 GitHub token 显 last 4）；
 * preview 与凭据值同红线——任何日志/错误文案不得输出。
 */
export function maskCredential(value: string): string {
    const len = value.length
    if (len >= 12) return `${value.slice(0, 5)}${'*'.repeat(6)}${value.slice(-2)}`
    if (len >= 8) return `${value.slice(0, 3)}${'*'.repeat(4)}${value.slice(-2)}`
    return '*'.repeat(len)
}

/** web 配置页回显用：凭据值替换为 { set: true/false, preview? } */
export function redactWebToolsConfig(config: WebToolsConfig): RedactedWebToolsConfig {
    const { providers, ...rest } = config
    return {
        ...rest,
        ...(providers
            ? {
                  providers: providers.map(({ credentials, ...provider }) => ({
                      ...provider,
                      credentials: Object.fromEntries(
                          credentialKeysFor(provider.id).map((key) => [
                              key,
                              credentials[key]
                                  ? { set: true, preview: maskCredential(credentials[key]) }
                                  : { set: false },
                          ]),
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

/**
 * 存量配置归一：读取落盘数据（不可信输入）时的统一入口。
 *
 * schema 收窄（如 provider 下线）后，旧机器的 settings.json 可能残留未知 provider
 * 条目，整体 parse 会抛错——若读取侧直接回退空配置，合法条目会被一个下线条目
 * "连坐"清空（web 工具静默禁用、配置页无法自修复）。此处降级容错：
 * 剔除未知/非法 provider 条目、清空指向它们的选择，保留其余合法配置。
 * 合法输入走正常 parse（默认值填充等语义不变），永不抛错。
 */
export function normalizeWebToolsConfig(raw: unknown): WebToolsConfig {
    const parsed = WebToolsConfigSchema.safeParse(raw)
    if (parsed.success) return parsed.data
    if (typeof raw !== 'object' || raw === null) return {}
    const record = raw as Record<string, unknown>

    // 逐条校验 providers：未知 id/非法条目丢弃，重复 id 保留首条（对齐 schema 唯一性语义）
    const providers: WebToolProviderSettings[] = []
    if (Array.isArray(record.providers)) {
        for (const item of record.providers) {
            const entry = WebToolProviderSettingsSchema.safeParse(item)
            if (!entry.success || providers.some((p) => p.id === entry.data.id)) continue
            providers.push(entry.data)
        }
    }

    // 选择指向被剔除/未知条目 → 清空（schema 容忍中间态，路由层对此返回 null）
    const knownId = (id: unknown): WebToolProviderId | undefined =>
        typeof id === 'string' && providers.some((p) => p.id === id) ? (id as WebToolProviderId) : undefined
    const searchProviderId = knownId(record.searchProviderId)
    const fetchProviderId = knownId(record.fetchProviderId)

    return {
        ...(searchProviderId ? { searchProviderId } : {}),
        ...(fetchProviderId ? { fetchProviderId } : {}),
        ...(providers.length > 0 ? { providers } : {}),
    }
}
