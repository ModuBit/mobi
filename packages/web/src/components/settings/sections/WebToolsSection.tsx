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

import { useState } from 'react'
import { Alert, App, theme as antTheme } from 'antd'
import { useTranslation } from 'react-i18next'
import styled from '@emotion/styled'
import {
    WEB_TOOL_PROVIDER_IDS,
    credentialKeysFor,
    type WebToolProviderId,
    type WebToolProviderSubmission,
} from '@mobi/shared'
import { useMobiApi } from '@/core/data/api/client'
import { useWebToolsConfig } from '@/core/data/hooks/queries/useWebToolsConfig'
import { RouteCard } from '@/components/settings/webtools/RouteCard'
import { ProviderCard } from '@/components/settings/webtools/ProviderCard'
import type { ProviderEntry, VerifyResult } from '@/components/settings/webtools/CredentialEditor'

const { useToken } = antTheme

type Token = ReturnType<typeof useToken>['token']

/** 空占位：首次加载中保持子页高度，避免布局跳动（invalidate 重读不卸载，不回到此态） */
const Placeholder = styled.div`
    min-height: 160px;
`

const Wrap = styled.div<{ $token: Token }>`
    display: flex;
    flex-direction: column;
    gap: ${p => p.$token.margin}px;
`

// 小节标签：等宽大写 + 字距（延续 GuideSection LayerLabel 语言）
const SectionLabel = styled.div<{ $token: Token }>`
    font-family: ${p => p.$token.fontFamilyCode};
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: ${p => p.$token.colorTextSecondary};
    font-weight: 600;
    margin: 6px 0 3px;
`

const CardStack = styled.div<{ $token: Token }>`
    display: flex;
    flex-direction: column;
    gap: ${p => p.$token.marginXS}px;
`

const Hint = styled.span<{ $token: Token }>`
    font-size: 11.5px;
    color: ${p => p.$token.colorTextTertiary};
    line-height: 1.5;
`

/**
 * Web 工具子页：顶部用途路由卡（web_search/web_fetch 即时保存）+ 下方 provider 卡列表
 * （开关外置、点击卡身展开内联凭据编辑器）。
 * 配置真相源在目标机器的 `~/.mobi/settings.json`（hub 纯透传 runner RPC）。
 */
export function WebToolsSection() {
    const { token } = useToken()
    const { t } = useTranslation()
    const api = useMobiApi()
    const { message } = App.useApp()
    const { machineId, config, offline, loadError, loaded, saving, save } = useWebToolsConfig()
    // 展开态提升到本层持有：保存后 invalidate 重读脱敏配置，子树不卸载编辑器不收起，A 卡展开时操作 B 卡互不影响
    const [expandedId, setExpandedId] = useState<WebToolProviderId | null>(null)

    const providerEntry = (id: WebToolProviderId): ProviderEntry | undefined =>
        config?.providers?.find((p) => p.id === id)

    const enabledIds = WEB_TOOL_PROVIDER_IDS.filter((id) => providerEntry(id)?.enabled)

    /**
     * 全量 provider 提交条目（providers 整体替换语义：提交必须覆盖全部 id，缺谁落盘就丢谁）。
     * targetId 的 provider 应用 patch：开关走显式 enabled；凭据首次保存时机器尚无条目 → 连带启用（填凭据即启用）。
     * 不指定 target（路由变更）= 纯回填全部现值。凭据键不在场 = 保持旧值（在场性协议）。
     */
    const providersWith = (
        targetId?: WebToolProviderId,
        patch: { enabled?: boolean; credentials?: Record<string, string> } = {},
    ): WebToolProviderSubmission[] =>
        WEB_TOOL_PROVIDER_IDS.map((pid) => {
            const entry = providerEntry(pid)
            if (pid !== targetId) {
                return { id: pid, enabled: entry?.enabled ?? false, timeoutMs: entry?.timeoutMs ?? 15_000, credentials: {} }
            }
            return {
                id: pid,
                enabled: patch.enabled ?? entry?.enabled ?? Boolean(patch.credentials),
                // 超时非本页可编辑项，回传已加载值避免落盘被 schema 默认值覆盖
                timeoutMs: entry?.timeoutMs ?? 15_000,
                credentials: patch.credentials ?? {},
            }
        })

    /**
     * 即时保存（路由/开关/凭据）。
     * 路由字段：undefined = 未提及回填现值；null = 显式清除（allowClear）——providers/路由整体替换语义下
     * 构造 payload 时必须区分这两者，否则清除意图会被回填吞掉。
     * 失败提示统一在此收口并透传 runner 原因（编辑器静默依赖本约定）。
     */
    const saveBase = async (next: {
        searchProviderId?: WebToolProviderId | null
        fetchProviderId?: WebToolProviderId | null
        providers: WebToolProviderSubmission[]
    }) => {
        const search = next.searchProviderId !== undefined ? next.searchProviderId : config?.searchProviderId
        const fetch = next.fetchProviderId !== undefined ? next.fetchProviderId : config?.fetchProviderId
        const result = await save({
            ...(search ? { searchProviderId: search } : {}),
            ...(fetch ? { fetchProviderId: fetch } : {}),
            providers: next.providers,
        })
        if (!result.ok) {
            message.error(result.error || t('settings.webTools.saveFailed'))
            return false
        }
        return true // hook 已 invalidate 共享缓存自动重读
    }

    /** 验证连接：传输层异常（502 等）收敛为失败 envelope，S9 编辑器统一按 success:false 呈现 */
    const verifyCredentials = async (
        id: WebToolProviderId,
        credentials: Record<string, string>,
    ): Promise<VerifyResult> => {
        if (!machineId) return { success: false, error: t('settings.webTools.offline') }
        try {
            return (await api.machines.webTools.verify(machineId, id, credentials)).data
        } catch {
            return { success: false, error: t('settings.webTools.loadFailed') }
        }
    }

    /** 该 provider 当前承担的用途（禁用拦截提示用） */
    const referencedBy = (id: WebToolProviderId): ('search' | 'fetch')[] =>
        [config?.searchProviderId === id && 'search', config?.fetchProviderId === id && 'fetch'].filter(
            (r): r is 'search' | 'fetch' => Boolean(r),
        )

    if (!loaded) return <Placeholder />

    return (
        <Wrap $token={token}>
            {offline && <Alert type="warning" showIcon title={t('settings.webTools.offline')} />}
            {loadError !== null && <Alert type="error" showIcon title={loadError || t('settings.webTools.loadFailed')} />}

            {config && !offline && loadError === null && (
                <>
                    <RouteCard
                        config={config}
                        enabledIds={[...enabledIds]}
                        saving={saving}
                        onChange={(next) => saveBase({ ...next, providers: providersWith() })}
                    />

                    <SectionLabel $token={token}>{t('settings.webTools.providersTitle')}</SectionLabel>
                    <CardStack $token={token}>
                        {WEB_TOOL_PROVIDER_IDS.map((id) => {
                            const entry = providerEntry(id)
                            // 机器上尚无条目的 provider 合成默认卡（未启用、凭据未设），与真实条目走同一条保存链路
                            const provider: ProviderEntry = entry ?? {
                                id,
                                enabled: false,
                                timeoutMs: 15_000,
                                credentials: Object.fromEntries(
                                    credentialKeysFor(id).map((key) => [key, { set: false }]),
                                ),
                            }
                            return (
                                <ProviderCard
                                    key={id}
                                    provider={provider}
                                    referencedBy={referencedBy(id)}
                                    expanded={expandedId === id}
                                    onExpandedChange={(expanded) => setExpandedId(expanded ? id : null)}
                                    saving={saving}
                                    onToggle={(enabled) => saveBase({ providers: providersWith(id, { enabled }) })}
                                    onSaveCredentials={(credentials) => saveBase({ providers: providersWith(id, { credentials }) })}
                                    onVerify={(credentials) => verifyCredentials(id, credentials)}
                                />
                            )
                        })}
                    </CardStack>
                    <Hint $token={token}>{t('settings.webTools.storageHint')}</Hint>
                </>
            )}
        </Wrap>
    )
}
