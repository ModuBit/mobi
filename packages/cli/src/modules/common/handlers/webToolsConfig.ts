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
 * web 工具配置 RPC（machine 级，注册在 runner 进程）：
 * - get-web-tools-config：读 settings.webTools，存量归一后凭据脱敏回显
 * - set-web-tools-config：submission schema-parse → 锁内凭据 merge（在场性三分支：键不在场/空串=保持、null=清除、非空=覆盖）+ 选择校验 → updateSettings 落盘（文件锁+原子写）
 * - verify-web-tools-provider：用草稿（优先）或已存凭据发起一次真实搜索，验证连通性并返回延迟
 * 生效：各会话进程 handler 调用时 mtime 惰性重读，无需通知。
 */
import {
    WEB_TOOL_PROVIDER_IDS,
    WebToolsConfigSubmissionSchema,
    normalizeWebToolsConfig,
    redactWebToolsConfig,
    credentialKeysFor,
    type WebToolsConfig,
    type WebToolsConfigSubmission,
    type WebToolProviderSettings,
    type WebToolProviderId,
    type RedactedWebToolsConfig,
} from '@mobi/shared'
import { updateSettings, readSettings } from '@/persistence'
import { createProviderFor } from '@/webtools/registry'
import type { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager'

export type ValidateResult = { ok: true; config: WebToolsConfigSubmission } | { ok: false; error: string }

/** schema 层校验：解析提交方向格式合法性（undefined（未传参）视为空配置；null/字符串等非法输入交给 schema 报错） */
export function parseWebToolsConfig(raw: unknown): ValidateResult {
    try {
        return { ok: true, config: WebToolsConfigSubmissionSchema.parse(raw === undefined ? {} : raw) }
    } catch (error) {
        return { ok: false, error: `webTools 配置格式非法：${error instanceof Error ? error.message : String(error)}` }
    }
}

/**
 * 选择层校验：search/fetch 选中的 provider 必须已启用且凭据齐全
 * （schema 容忍中间态，此为写入侧把关；应在凭据 merge 之后对最终落盘配置调用）
 * @returns 错误消息；null 表示通过
 */
export function validateSelection(config: WebToolsConfig): string | null {
    for (const selectedId of [config.searchProviderId, config.fetchProviderId]) {
        if (!selectedId) continue
        const provider = config.providers?.find((p) => p.id === selectedId)
        if (!provider || !provider.enabled) {
            return `provider "${selectedId}" 不存在或未启用`
        }
        const missing = credentialKeysFor(selectedId).filter((key) => !provider.credentials[key])
        if (missing.length > 0) {
            return `provider "${selectedId}" 缺少凭据：${missing.join(', ')}`
        }
    }
    return null
}

/**
 * 凭据 merge（在场性三分支）：键不在场或空串 → 保持旧值（不在场=新 UI 未修改，
 * 空串=旧客户端全量提交兼容）；null → 清除；非空 → 覆盖。merge 产物是严格落盘类型（纯 string）。
 */
export function mergeProviderCredentials(current: WebToolsConfig, incoming: WebToolsConfigSubmission): WebToolsConfig {
    const currentProviders = current.providers ?? []
    const mergedProviders = incoming.providers?.map((p) => {
        const old = currentProviders.find((o) => o.id === p.id)
        const credentials: Record<string, string> = { ...old?.credentials }
        for (const [key, value] of Object.entries(p.credentials)) {
            if (value === null) delete credentials[key]
            else if (value === '') continue
            else credentials[key] = value
        }
        return { ...p, credentials } as WebToolProviderSettings
    })
    return { ...incoming, providers: mergedProviders } as WebToolsConfig
}

/** 注册到 runner 的 machine 级 RPC（apiMachine 构造器调用） */
export function registerWebToolsConfigHandler(rpcHandlerManager: RpcHandlerManager): void {
    rpcHandlerManager.registerHandler<Record<string, never>, { config: RedactedWebToolsConfig } | { error: string }>(
        'get-web-tools-config',
        async () => {
            try {
                const settings = await readSettings()
                // 存量归一：残留已下线 provider 条目剔除而非整体清空（损坏输入同样回退空配置），不抛 RPC error
                return { config: redactWebToolsConfig(normalizeWebToolsConfig(settings.webTools)) }
            } catch (error) {
                // 读盘 IO 失败（如权限/磁盘）：显式 error envelope，Web 侧区别于"机器离线"提示
                return { error: `读取 web 工具配置失败：${error instanceof Error ? error.message : String(error)}` }
            }
        },
    )

    rpcHandlerManager.registerHandler<{ config: unknown }, { success: true } | { success: false; error: string }>(
        'set-web-tools-config',
        async (params) => {
            // 顺序：先 schema-parse incoming，锁内凭据 merge（在场性三分支）后对 merge 结果做选择校验。
            // 若先校验后 merge，脱敏页"未修改保持不变"的保存会被"缺少凭据"误拒；
            // merge/校验放在 updateSettings 的 updater 闭包内，消除锁外快照的并发丢更新窗口
            const parsed = parseWebToolsConfig(params?.config)
            if (!parsed.ok) return { success: false, error: parsed.error }
            try {
                await updateSettings((s) => {
                    // 存量归一：残留已下线 provider 条目剔除，保存不被存量砖化阻塞
                    const currentConfig = normalizeWebToolsConfig(s.webTools)
                    const merged = mergeProviderCredentials(currentConfig, parsed.config)
                    const error = validateSelection(merged)
                    if (error) throw new Error(error) // updater 抛出则不落盘
                    return { ...s, webTools: merged }
                })
                return { success: true }
            } catch (error) {
                return { success: false, error: error instanceof Error ? error.message : String(error) }
            }
        },
    )

    // 凭据连通性验证：保存前用草稿 key 试连（草稿非空优先，其余沿用已存值），
    // 一次真实 search 的往返延迟即验证结果；不落盘、不泄露凭据值
    rpcHandlerManager.registerHandler<
        { providerId: WebToolProviderId; credentials?: Record<string, string> },
        { ok: true; latencyMs: number } | { ok: false; error: string }
    >('verify-web-tools-provider', async (params) => {
        if (!params?.providerId) return { ok: false, error: '缺少 providerId' }
        // RPC 边界无 schema 校验（params 类型仅为声明），未知 id 提前拒绝而非让 credentialKeysFor 抛 TypeError
        if (!WEB_TOOL_PROVIDER_IDS.includes(params.providerId)) {
            return { ok: false, error: `未知 provider：${params.providerId}` }
        }
        try {
            const settings = await readSettings()
            const config = normalizeWebToolsConfig(settings.webTools)
            const entry = config.providers?.find((p) => p.id === params.providerId)
            // 凭据合成：草稿非空字符串优先，其余用已存值
            const merged: Record<string, string> = { ...entry?.credentials }
            for (const [key, value] of Object.entries(params.credentials ?? {})) {
                if (typeof value === 'string' && value) merged[key] = value
            }
            const required = credentialKeysFor(params.providerId)
            const missing = required.filter((key) => !merged[key])
            if (missing.length > 0) return { ok: false, error: `缺少凭据：${missing.join(', ')}` }
            const provider = createProviderFor(params.providerId, {
                apiKey: merged[required[0]!]!,
                timeoutMs: entry?.timeoutMs ?? 15_000,
            })
            const started = Date.now()
            await provider.search({ query: 'connection test' })
            return { ok: true, latencyMs: Date.now() - started }
        } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : String(error) }
        }
    })
}
