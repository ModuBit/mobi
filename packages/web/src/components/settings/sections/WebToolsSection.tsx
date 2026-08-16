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
    type WebToolsConfigSubmission,
} from '@mobi/shared'
import { useMobiApi } from '@/core/data/api/client'
import { useWebToolsConfig } from '@/components/settings/webtools/useWebToolsConfig'
import { RouteCard } from '@/components/settings/webtools/RouteCard'
import { ProviderCard } from '@/components/settings/webtools/ProviderCard'
import type { ProviderEntry, VerifyResult } from '@/components/settings/webtools/CredentialEditor'

const { useToken } = antTheme

type Token = ReturnType<typeof useToken>['token']

/** 基础配置提交里的 provider 条目（凭据键全不在场 = 保持旧值） */
type BaseProvider = { id: WebToolProviderId; enabled: boolean; timeoutMs: number; credentials: Record<string, never> }

/** 空占位：加载中保持子页高度，避免布局跳动 */
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
    const { machineId, config, offline, loadError, loaded, reload, saving, save } = useWebToolsConfig()
    // 展开态提升到本层持有：reload 重读脱敏配置后编辑器不收起，A 卡展开时操作 B 卡互不影响
    const [expandedId, setExpandedId] = useState<WebToolProviderId | null>(null)

    /** 提交方向 provider 条目（在场性凭据） */
    type SubmissionProvider = WebToolsConfigSubmission['providers'] extends (infer P)[] | undefined ? P : never

    const providerEntry = (id: WebToolProviderId): ProviderEntry | undefined =>
        config?.providers?.find((p) => p.id === id)

    const enabledIds = WEB_TOOL_PROVIDER_IDS.filter((id) => providerEntry(id)?.enabled)

    /** 全量 provider 基础配置（凭据键全不在场 = 保持旧值），开关/路由变更走这条通道 */
    const baseProviders = (): BaseProvider[] =>
        WEB_TOOL_PROVIDER_IDS.map((id) => ({
            id,
            enabled: providerEntry(id)?.enabled ?? false,
            // 超时非本页可编辑项，回传已加载值避免落盘被 schema 默认值覆盖
            timeoutMs: providerEntry(id)?.timeoutMs ?? 15_000,
            credentials: {},
        }))

    /**
     * 即时保存基础配置（开关/路由）：next 覆盖对应字段，路由字段缺省回填现有值（整体替换语义）。
     * 成功后 reload() 重读脱敏配置；开关/路由即时生效无需 success 打扰。
     */
    const saveBase = async (next: { searchProviderId?: WebToolProviderId; fetchProviderId?: WebToolProviderId; providers: SubmissionProvider[] }) => {
        const ok = await save({
            ...(config?.searchProviderId ? { searchProviderId: config.searchProviderId } : {}),
            ...(config?.fetchProviderId ? { fetchProviderId: config.fetchProviderId } : {}),
            ...next,
        })
        if (!ok) {
            message.error(t('settings.webTools.saveFailed'))
            return false
        }
        reload()
        return true
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
                        onChange={(next) => saveBase({ ...next, providers: baseProviders() })}
                    />

                    <SectionLabel $token={token}>{t('settings.webTools.providersTitle')}</SectionLabel>
                    <CardStack $token={token}>
                        {WEB_TOOL_PROVIDER_IDS.map((id) => {
                            const entry = providerEntry(id)
                            if (!entry) {
                                // 机器上尚无该 provider 条目：展示未启用默认卡；首次提交凭据时连带 enabled:true（填凭据即启用）
                                return (
                                    <ProviderCard
                                        key={id}
                                        provider={{
                                            id,
                                            enabled: false,
                                            timeoutMs: 15_000,
                                            credentials: Object.fromEntries(
                                                credentialKeysFor(id).map((key) => [key, { set: false }]),
                                            ),
                                        }}
                                        referencedBy={[]}
                                        expanded={expandedId === id}
                                        onExpandedChange={(expanded) => setExpandedId(expanded ? id : null)}
                                        saving={saving}
                                        onToggle={(enabled) =>
                                            saveBase({
                                                providers: baseProviders().map((p) => (p.id === id ? { ...p, enabled } : p)),
                                            })
                                        }
                                        onSaveCredentials={(credentials) =>
                                            saveBase({
                                                providers: [
                                                    { id, enabled: true, timeoutMs: 15_000, credentials },
                                                ],
                                            })
                                        }
                                        onVerify={(credentials) => verifyCredentials(id, credentials)}
                                    />
                                )
                            }
                            return (
                                <ProviderCard
                                    key={id}
                                    provider={entry}
                                    referencedBy={referencedBy(id)}
                                    expanded={expandedId === id}
                                    onExpandedChange={(expanded) => setExpandedId(expanded ? id : null)}
                                    saving={saving}
                                    onToggle={(enabled) =>
                                        saveBase({
                                            providers: baseProviders().map((p) => (p.id === id ? { ...p, enabled } : p)),
                                        })
                                    }
                                    onSaveCredentials={async (credentials) => {
                                        // 在场性提交：目标 provider 只带被编辑的凭据键，其余 provider 全量在场（credentials 键不在场=保持旧值）；
                                        // 必须走 saveBase 回填路由字段——providers 整体替换语义下缺路由字段会静默清空路由
                                        return saveBase({
                                            providers: baseProviders().map((p) =>
                                                p.id === id
                                                    ? { id, enabled: entry.enabled, timeoutMs: entry.timeoutMs, credentials }
                                                    : p,
                                            ),
                                        })
                                    }}
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
