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

import { App } from 'antd'
import { useTranslation } from 'react-i18next'
import {
    WEB_TOOL_PROVIDER_IDS,
    credentialKeysFor,
    type RedactedWebToolsConfig,
    type WebToolProviderId,
    type WebToolProviderSubmission,
} from '@mobi/shared'
import { useWebToolsConfig } from '@/core/data/hooks/queries/useWebToolsConfig'

/** 脱敏配置中的 provider 条目（凭据只有 set 标记 + 掩码 preview，无明文） */
export type ProviderEntry = NonNullable<RedactedWebToolsConfig['providers']>[number]

/** 未配置 provider 的默认超时（提交构造与展示投影共用同一默认） */
export const DEFAULT_PROVIDER_TIMEOUT_MS = 15_000

export interface WebToolsSubmissionApi {
    config: RedactedWebToolsConfig | null
    loaded: boolean
    offline: boolean
    loadError: string | null
    saving: boolean
    /** 全 id 展示投影：机器尚无条目的 provider 合成默认条目（未启用、凭据未设），与提交构造同源 */
    providerEntries: ProviderEntry[]
    /** 意图：设置某用途路由（即时保存，未提及路由回填现值——整体替换语义不清空另一路） */
    setRoute: (slot: 'search' | 'fetch', providerId: WebToolProviderId) => Promise<boolean>
    /** 意图：清除某用途路由（整体替换语义下字段缺席 = 清除落盘，区别于未提及回填） */
    clearRoute: (slot: 'search' | 'fetch') => Promise<boolean>
    /** 意图：启停 provider（全量 providers 覆盖提交） */
    toggleProvider: (id: WebToolProviderId, enabled: boolean) => Promise<boolean>
    /** 意图：保存凭据（凭据键不在场 = 保持旧值；机器尚无条目时首存连带启用） */
    saveCredentials: (id: WebToolProviderId, credentials: Record<string, string>) => Promise<boolean>
}

/** 一次提交的意图形状：路由字段 undefined = 未提及回填现值，null = 显式清除 */
interface SubmissionIntent {
    searchProviderId?: WebToolProviderId | null
    fetchProviderId?: WebToolProviderId | null
    providers?: { targetId?: WebToolProviderId; patch?: { enabled?: boolean; credentials?: Record<string, string> } }
}

/**
 * Web 工具提交构造模块（deep hook）——「在场性协议」的唯一承载：
 *
 * - providers 整体替换：提交必须覆盖全部 id，缺谁落盘就丢谁；未配置的 provider 以默认条目
 *   （禁用/默认超时 15000）随全量提交；已配置的回填现值（含 timeoutMs，防被 schema 默认重置）
 * - 路由字段三义性：意图方法的参数即意图（setRoute/clearRoute），payload 构造时区分
 *   「未提及（回填现值）」与「显式清除（字段缺席）」
 * - 凭据键不在场 = 保持旧值（编辑器只提交编辑中的键）；机器尚无条目时首存凭据连带启用
 * - 失败呈现收口：message.error 透传 daemon 原因，编辑器静默依赖本约定（收到 false 保持编辑态）
 * - 成功后 invalidate 重读由 useWebToolsConfig 负责（共享缓存自动重读）
 *
 * 调用方（RouteCard / ProviderCard / CredentialEditor）只表达意图，协议不可说错。
 */
export function useWebToolsSubmission(): WebToolsSubmissionApi {
    const { t } = useTranslation()
    const { message } = App.useApp()
    const { config, offline, loadError, loaded, saving, save } = useWebToolsConfig()

    const providerEntry = (id: WebToolProviderId): ProviderEntry | undefined =>
        config?.providers?.find((p) => p.id === id)

    /**
     * 全量 provider 提交条目构造：targetId 应用 patch，其余回填现值。
     * 凭据首次保存时机器尚无条目 → 连带启用（patch.credentials 在场即启用意图）。
     */
    const providersWith = (
        targetId?: WebToolProviderId,
        patch: { enabled?: boolean; credentials?: Record<string, string> } = {},
    ): WebToolProviderSubmission[] =>
        WEB_TOOL_PROVIDER_IDS.map((pid) => {
            const entry = providerEntry(pid)
            if (pid !== targetId) {
                return { id: pid, enabled: entry?.enabled ?? false, timeoutMs: entry?.timeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS, credentials: {} }
            }
            return {
                id: pid,
                enabled: patch.enabled ?? entry?.enabled ?? Boolean(patch.credentials),
                timeoutMs: entry?.timeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS,
                credentials: patch.credentials ?? {},
            }
        })

    /**
     * 即时保存：意图 → 合法 payload。失败提示在此收口并透传 daemon 原因。
     * 路由字段：undefined = 未提及回填现值；null = 显式清除（payload 字段缺席）。
     */
    const submit = async (intent: SubmissionIntent): Promise<boolean> => {
        const search = intent.searchProviderId !== undefined ? intent.searchProviderId : config?.searchProviderId
        const fetchRoute = intent.fetchProviderId !== undefined ? intent.fetchProviderId : config?.fetchProviderId
        const result = await save({
            ...(search ? { searchProviderId: search } : {}),
            ...(fetchRoute ? { fetchProviderId: fetchRoute } : {}),
            providers: intent.providers
                ? providersWith(intent.providers.targetId, intent.providers.patch)
                : providersWith(),
        })
        if (!result.ok) {
            message.error(result.error || t('settings.webTools.saveFailed'))
            return false
        }
        return true
    }

    // 展示投影：与提交构造同源的默认合成（未配置 provider 的卡片展示与落盘默认一致）
    const providerEntries: ProviderEntry[] = WEB_TOOL_PROVIDER_IDS.map((id) => {
        const entry = providerEntry(id)
        return entry ?? {
            id,
            enabled: false,
            timeoutMs: DEFAULT_PROVIDER_TIMEOUT_MS,
            credentials: Object.fromEntries(
                credentialKeysFor(id).map((key) => [key, { set: false }]),
            ),
        }
    })

    return {
        config,
        loaded,
        offline,
        loadError,
        saving,
        providerEntries,
        setRoute: (slot, providerId) =>
            submit(slot === 'search' ? { searchProviderId: providerId } : { fetchProviderId: providerId }),
        clearRoute: (slot) =>
            submit(slot === 'search' ? { searchProviderId: null } : { fetchProviderId: null }),
        toggleProvider: (id, enabled) => submit({ providers: { targetId: id, patch: { enabled } } }),
        saveCredentials: (id, credentials) => submit({ providers: { targetId: id, patch: { credentials } } }),
    }
}
