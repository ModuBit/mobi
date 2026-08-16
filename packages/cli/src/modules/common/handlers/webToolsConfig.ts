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
 * - get-web-tools-config：读 settings.webTools，凭据脱敏回显（存量损坏时回退空配置）
 * - set-web-tools-config：schema-parse → 锁内凭据 merge（空值=保持不变）+ 选择校验 → updateSettings 落盘（文件锁+原子写）
 * 生效：各会话进程 handler 调用时 mtime 惰性重读，无需通知。
 */
import { WebToolsConfigSchema, redactWebToolsConfig, credentialKeysFor, type WebToolsConfig, type RedactedWebToolsConfig } from '@mobi/shared'
import { updateSettings, readSettings } from '@/persistence'
import type { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager'

export type ValidateResult = { ok: true; config: WebToolsConfig } | { ok: false; error: string }

/** schema 层校验：解析格式合法性（undefined（未传参）视为空配置；null/字符串等非法输入交给 schema 报错） */
export function parseWebToolsConfig(raw: unknown): ValidateResult {
    try {
        return { ok: true, config: WebToolsConfigSchema.parse(raw === undefined ? {} : raw) }
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

/** 写入校验 = schema 层 + 选择层组合（无既有凭据可 merge 的场景一次性校验） */
export function validateWebToolsConfig(raw: unknown): ValidateResult {
    const parsed = parseWebToolsConfig(raw)
    if (!parsed.ok) return parsed
    const error = validateSelection(parsed.config)
    if (error) return { ok: false, error }
    return parsed
}

/**
 * 凭据 merge：web 配置页只回传本次填写的凭据（脱敏回显不回传值），
 * 空字符串 = 保持旧值不动；非空 = 覆盖。新条目直接采用新值。
 */
export function mergeProviderCredentials(current: WebToolsConfig, incoming: WebToolsConfig): WebToolsConfig {
    const currentProviders = current.providers ?? []
    const mergedProviders = incoming.providers?.map((p) => {
        const old = currentProviders.find((o) => o.id === p.id)
        const credentials = { ...old?.credentials }
        for (const [key, value] of Object.entries(p.credentials)) {
            if (value) credentials[key] = value // 空值 = 保持不变
        }
        return { ...p, credentials }
    })
    return { ...incoming, providers: mergedProviders }
}

/** 注册到 runner 的 machine 级 RPC（apiMachine 构造器调用） */
export function registerWebToolsConfigHandler(rpcHandlerManager: RpcHandlerManager): void {
    rpcHandlerManager.registerHandler<Record<string, never>, { config: RedactedWebToolsConfig }>(
        'get-web-tools-config',
        async () => {
            const settings = await readSettings()
            // 存量配置损坏时回退空配置（与 readSettings 的容错姿态一致），不抛 RPC error
            const parsed = WebToolsConfigSchema.safeParse(settings.webTools ?? {})
            return { config: redactWebToolsConfig(parsed.success ? parsed.data : {}) }
        },
    )

    rpcHandlerManager.registerHandler<{ config: unknown }, { success: true } | { success: false; error: string }>(
        'set-web-tools-config',
        async (params) => {
            // 顺序：先 schema-parse incoming，锁内 merge 旧凭据（空值=保持不变）后对 merge 结果做选择校验。
            // 若先校验后 merge，脱敏页"留空保持不变"的保存会被"缺少凭据"误拒；
            // merge/校验放在 updateSettings 的 updater 闭包内，消除锁外快照的并发丢更新窗口
            const parsed = parseWebToolsConfig(params?.config)
            if (!parsed.ok) return { success: false, error: parsed.error }
            try {
                await updateSettings((s) => {
                    const currentConfig = WebToolsConfigSchema.parse(s.webTools ?? {})
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
}
