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
import { Alert, theme as antTheme } from 'antd'
import { useTranslation } from 'react-i18next'
import styled from '@emotion/styled'
import { type WebToolProviderId } from '@mobi/shared'
import { useMobiApi } from '@/core/data/api/client'
import { useWebToolsSubmission } from '@/features/settings/webtools/useWebToolsSubmission'
import { RouteCard } from '@/features/settings/webtools/RouteCard'
import { ProviderCard } from '@/features/settings/webtools/ProviderCard'
import { SettingGroupCard } from '@/features/settings/blocks/SettingGroupCard'
import type { VerifyResult } from '@/features/settings/webtools/CredentialEditor'

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

const Hint = styled.span<{ $token: Token }>`
    font-size: 11.5px;
    color: ${p => p.$token.colorTextTertiary};
    line-height: 1.5;
`

/**
 * Web 工具子页：顶部用途路由卡（web_search/web_fetch 即时保存）+ 下方 provider 卡列表
 * （开关外置、点击卡身展开内联凭据编辑器）。
 * 提交构造（providers 整体替换/路由三义性/首存连带启用/失败 toast 收口）归 useWebToolsSubmission，
 * 本组件只做编排与展示语义（展开态、referencedBy 拦截提示、验证连接）。
 * 配置真相源在宿主的 `~/.mobi/settings.json`（daemon 纯透传 executor RPC）。
 */
export function WebToolsSection() {
    const { token } = useToken()
    const { t } = useTranslation()
    const api = useMobiApi()
    const { config, offline, loadError, loaded, saving, providerEntries, setRoute, clearRoute, toggleProvider, saveCredentials } = useWebToolsSubmission()
    // 展开态提升到本层持有：保存后 invalidate 重读脱敏配置，子树不卸载编辑器不收起，A 卡展开时操作 B 卡互不影响
    const [expandedId, setExpandedId] = useState<WebToolProviderId | null>(null)

    const enabledIds = providerEntries.filter((p) => p.enabled).map((p) => p.id)

    /** 验证连接：传输层异常（502 等）收敛为失败 envelope，编辑器统一按 success:false 呈现 */
    const verifyCredentials = async (
        id: WebToolProviderId,
        credentials: Record<string, string>,
    ): Promise<VerifyResult> => {
        try {
            return (await api.webTools.verify(id, credentials)).data
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
                        enabledIds={enabledIds}
                        saving={saving}
                        onSetRoute={setRoute}
                        onClearRoute={clearRoute}
                    />

                    {/* PROVIDERS 分组无缝卡：卡间分隔线归容器（SettingGroupCard） */}
                    <SettingGroupCard title={t('settings.webTools.providersTitle')}>
                        {providerEntries.map((provider) => (
                            <ProviderCard
                                key={provider.id}
                                provider={provider}
                                referencedBy={referencedBy(provider.id)}
                                expanded={expandedId === provider.id}
                                onExpandedChange={(expanded) => setExpandedId(expanded ? provider.id : null)}
                                saving={saving}
                                onToggle={(enabled) => toggleProvider(provider.id, enabled)}
                                onSaveCredentials={(credentials) => saveCredentials(provider.id, credentials)}
                                onVerify={(credentials) => verifyCredentials(provider.id, credentials)}
                            />
                        ))}
                    </SettingGroupCard>
                    <Hint $token={token}>{t('settings.webTools.storageHint')}</Hint>
                </>
            )}
        </Wrap>
    )
}
