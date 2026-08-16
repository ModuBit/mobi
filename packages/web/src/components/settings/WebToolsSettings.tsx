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

import { useEffect, useState } from 'react'
import { Alert, App, Button, Input, Select, Switch, theme as antTheme } from 'antd'
import { GlobalOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import styled from '@emotion/styled'
import {
    WEB_TOOL_PROVIDER_IDS,
    credentialKeysFor,
    type RedactedWebToolsConfig,
    type WebToolProviderId,
} from '@mobi/shared'
import { useMobiApi } from '@/core/data/api/client'
import { IconBox, enter } from './blocks/shared'

const { useToken } = antTheme

type Token = ReturnType<typeof useToken>['token']

/** 凭据草稿按 `${providerId}.${credentialKey}` 扁平存储，避免嵌套 state 更新样板 */
const credKey = (providerId: string, key: string): string => `${providerId}.${key}`
/** 全量凭据草稿（含未启用 provider），提交时原样带空串——runner 侧空值 = 保持旧值 */
type CredentialDraft = Record<string, string>

const Wrap = styled.div<{ $token: Token }>`
    display: flex;
    flex-direction: column;
    gap: ${p => p.$token.marginXS}px;
`

// 卡片：与 NotificationSettings 主卡同族（容器色 + 细边框 + 入场动画），去 alert 感
const Card = styled.section<{ $token: Token }>`
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 18px ${p => p.$token.padding}px;
    border-radius: ${p => p.$token.borderRadiusLG}px;
    background: ${p => p.$token.colorBgContainer};
    border: 1px solid ${p => p.$token.colorBorderSecondary};
    animation: ${enter} 0.3s ease-out;
`

const HeadRow = styled.div<{ $token: Token }>`
    display: flex;
    align-items: center;
    gap: ${p => p.$token.marginSM}px;
`

const HeadText = styled.div<{ $token: Token }>`
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
`

const Title = styled.span<{ $token: Token }>`
    font-weight: 600;
    font-size: 14px;
    letter-spacing: -0.01em;
    color: ${p => p.$token.colorText};
`

const Desc = styled.span<{ $token: Token }>`
    font-size: 12.5px;
    line-height: 1.5;
    color: ${p => p.$token.colorTextTertiary};
`

// provider 配置块：细线分隔（首个无分隔线）
const ProviderBlock = styled.div<{ $token: Token }>`
    display: flex;
    flex-direction: column;
    gap: ${p => p.$token.marginSM}px;
    padding-top: 14px;
    border-top: 1px solid ${p => p.$token.colorBorderSecondary};

    &:first-of-type {
        padding-top: 0;
        border-top: none;
    }
`

const ProviderRow = styled.div<{ $token: Token }>`
    display: flex;
    align-items: center;
    gap: ${p => p.$token.marginSM}px;
`

const ProviderName = styled.span<{ $token: Token }>`
    font-weight: 500;
    font-size: 13.5px;
    color: ${p => p.$token.colorText};
    flex: 1;
    min-width: 0;
`

const CredRow = styled.div<{ $token: Token }>`
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding-left: 2px;
`

const CredLabel = styled.span<{ $token: Token }>`
    font-size: 12.5px;
    color: ${p => p.$token.colorTextSecondary};
`

// 凭据状态 extra：已存（绿）/未设（灰），与输入框同行右侧展示
const CredState = styled.span<{ $token: Token; $set: boolean }>`
    font-size: 12px;
    color: ${p => (p.$set ? p.$token.colorSuccessText : p.$token.colorTextTertiary)};
`

const SelectRow = styled.div<{ $token: Token }>`
    display: flex;
    flex-direction: column;
    gap: 4px;
`

const SelectLabel = styled.span<{ $token: Token }>`
    font-size: 12.5px;
    color: ${p => p.$token.colorTextSecondary};
`

const FooterRow = styled.div<{ $token: Token }>`
    display: flex;
    justify-content: flex-end;
    gap: ${p => p.$token.marginSM}px;
    padding-top: 14px;
    border-top: 1px solid ${p => p.$token.colorBorderSecondary};
`

/** 初始 enabled 态：全部 provider 默认关（无配置的 provider 视为未启用） */
const initialEnabled = (): Record<WebToolProviderId, boolean> =>
    Object.fromEntries(WEB_TOOL_PROVIDER_IDS.map((id) => [id, false])) as Record<WebToolProviderId, boolean>

/**
 * Web 工具设置卡片。
 *
 * 配置真相源在目标机器的 `~/.mobi/settings.json`（hub 纯透传 runner RPC）。
 * 凭据脱敏回显（只有"设没设"没有值），提交时凭据留空 = 保持旧值（runner 侧 merge）。
 * 机器选择：取第一台在线机器（多机选择器待后续）。
 */
export function WebToolsSettings() {
    const { token } = useToken()
    const { t } = useTranslation()
    const api = useMobiApi()
    const { message } = App.useApp()

    const [machineId, setMachineId] = useState<string | null>(null)
    /** 脱敏回显配置（凭据只有 set 标记），加载失败置 null + offline = true */
    const [redacted, setRedacted] = useState<RedactedWebToolsConfig | null>(null)
    const [offline, setOffline] = useState(false)
    const [loaded, setLoaded] = useState(false)
    const [enabledMap, setEnabledMap] = useState<Record<WebToolProviderId, boolean>>(initialEnabled)
    const [credDraft, setCredDraft] = useState<CredentialDraft>({})
    const [searchId, setSearchId] = useState<WebToolProviderId | undefined>(undefined)
    const [fetchId, setFetchId] = useState<WebToolProviderId | undefined>(undefined)
    const [saving, setSaving] = useState(false)

    useEffect(() => {
        let cancelled = false
        ;(async () => {
            try {
                // 两跳串行：机器列表（取第一台在线）→ 该机器的脱敏配置
                const machinesRes = await api.machines.list()
                const online = machinesRes.data.machines.find((m) => m.active)
                if (!online) throw new Error('no online machine')
                const configRes = await api.machines.webTools.get(online.id)
                if (cancelled) return
                const config = configRes.data.config
                setMachineId(online.id)
                setRedacted(config)
                setEnabledMap(
                    Object.fromEntries(
                        WEB_TOOL_PROVIDER_IDS.map((id) => [id, config.providers?.find((p) => p.id === id)?.enabled ?? false]),
                    ) as Record<WebToolProviderId, boolean>,
                )
                setSearchId(config.searchProviderId)
                setFetchId(config.fetchProviderId)
                setLoaded(true)
            } catch (error) {
                // 502（runner 离线）/ 网络异常 / 无在线机器，统一按"机器离线"提示；
                // warn 保留现场（先观测原则），编程错误不被静默吞掉
                console.warn('[WebToolsSettings] 加载配置失败', error)
                if (!cancelled) {
                    setOffline(true)
                    setLoaded(true)
                }
            }
        })()
        return () => {
            cancelled = true
        }
    }, [api])

    /** 保存：POST 完整 config（凭据空串原样提交，runner merge 保持旧值） */
    const handleSave = async () => {
        if (!machineId || saving) return
        setSaving(true)
        try {
            const { data } = await api.machines.webTools.set(machineId, {
                ...(searchId ? { searchProviderId: searchId } : {}),
                ...(fetchId ? { fetchProviderId: fetchId } : {}),
                providers: WEB_TOOL_PROVIDER_IDS.map((id) => ({
                    id,
                    enabled: enabledMap[id],
                    // 超时非本页可编辑项，回传已加载值避免落盘被 schema 默认值覆盖
                    timeoutMs: redacted?.providers?.find((p) => p.id === id)?.timeoutMs ?? 15_000,
                    credentials: Object.fromEntries(
                        credentialKeysFor(id).map((key) => [key, credDraft[credKey(id, key)] ?? '']),
                    ),
                })),
            })
            if (data?.success !== true) {
                message.error(data?.error || t('settings.webTools.saveFailed'))
                return
            }
            message.success(t('settings.webTools.saved'))
            // 本地同步脱敏态：已填写的凭据转为"已设置"，并清空草稿避免明文残留输入框
            setRedacted((prev) => ({
                ...prev,
                providers: WEB_TOOL_PROVIDER_IDS.map((id) => {
                    const loadedProvider = prev?.providers?.find((p) => p.id === id)
                    return {
                        id,
                        enabled: enabledMap[id],
                        timeoutMs: loadedProvider?.timeoutMs ?? 15_000,
                        credentials: Object.fromEntries(
                            credentialKeysFor(id).map((key) => [
                                key,
                                { set: Boolean(credDraft[credKey(id, key)]) || Boolean(loadedProvider?.credentials[key]?.set) },
                            ]),
                        ),
                    }
                }),
            }))
            setCredDraft({})
        } catch {
            // 502（runner 离线）等传输层异常
            message.error(t('settings.webTools.saveFailed'))
        } finally {
            setSaving(false)
        }
    }

    const providerOptions = WEB_TOOL_PROVIDER_IDS.filter((id) => enabledMap[id]).map((id) => ({
        value: id,
        label: t(`settings.webTools.providers.${id}`),
    }))
    // 未配置任何 provider：search/fetch 选择无意义，提示引导先启用并填写凭据
    const noneConfigured = loaded && !offline && !(redacted?.providers?.some((p) => p.enabled) || Object.values(enabledMap).some(Boolean))

    return (
        <Wrap $token={token}>
            <Card $token={token}>
                <HeadRow $token={token}>
                    <IconBox $token={token} aria-hidden="true">
                        <GlobalOutlined />
                    </IconBox>
                    <HeadText $token={token}>
                        <Title $token={token}>{t('settings.webTools.title')}</Title>
                        <Desc $token={token}>{t('settings.webTools.desc')}</Desc>
                    </HeadText>
                </HeadRow>

                {offline && (
                    <Alert type="warning" showIcon title={t('settings.webTools.offline')} />
                )}
                {noneConfigured && (
                    <Alert type="info" showIcon title={t('settings.webTools.notConfigured')} />
                )}

                {loaded && !offline && WEB_TOOL_PROVIDER_IDS.map((id) => {
                    const providerState = redacted?.providers?.find((p) => p.id === id)
                    return (
                        <ProviderBlock key={id} $token={token}>
                            <ProviderRow $token={token}>
                                <ProviderName $token={token}>{t(`settings.webTools.providers.${id}`)}</ProviderName>
                                <Switch
                                    size="small"
                                    aria-label={id}
                                    checked={enabledMap[id]}
                                    onChange={(checked) =>
                                        setEnabledMap((prev) => ({ ...prev, [id]: checked }))
                                    }
                                />
                            </ProviderRow>
                            {credentialKeysFor(id).map((key) => {
                                const set = Boolean(providerState?.credentials[key]?.set)
                                return (
                                    <CredRow key={key} $token={token}>
                                        <CredLabel $token={token}>
                                            {t('settings.webTools.apiKey')}
                                            <CredState $token={token} $set={set} style={{ marginLeft: 8 }}>
                                                {set
                                                    ? t('settings.webTools.credentialSet')
                                                    : t('settings.webTools.credentialUnset')}
                                            </CredState>
                                        </CredLabel>
                                        <Input.Password
                                            size="small"
                                            value={credDraft[credKey(id, key)] ?? ''}
                                            onChange={(e) =>
                                                setCredDraft((prev) => ({ ...prev, [credKey(id, key)]: e.target.value }))
                                            }
                                            placeholder={
                                                set
                                                    ? t('settings.webTools.credentialKeepPlaceholder')
                                                    : t('settings.webTools.credentialInputPlaceholder')
                                            }
                                            autoComplete="new-password"
                                        />
                                    </CredRow>
                                )
                            })}
                        </ProviderBlock>
                    )
                })}

                {loaded && !offline && (
                    <>
                        <SelectRow $token={token}>
                            <SelectLabel $token={token}>{t('settings.webTools.searchProvider')}</SelectLabel>
                            <Select
                                size="small"
                                allowClear
                                value={searchId}
                                onChange={(value) => setSearchId(value)}
                                options={providerOptions}
                                placeholder={t('settings.webTools.selectPlaceholder')}
                            />
                        </SelectRow>
                        <SelectRow $token={token}>
                            <SelectLabel $token={token}>{t('settings.webTools.fetchProvider')}</SelectLabel>
                            <Select
                                size="small"
                                allowClear
                                value={fetchId}
                                onChange={(value) => setFetchId(value)}
                                options={providerOptions}
                                placeholder={t('settings.webTools.selectPlaceholder')}
                            />
                        </SelectRow>
                        <FooterRow $token={token}>
                            <Button
                                type="primary"
                                size="small"
                                loading={saving}
                                disabled={!machineId}
                                onClick={() => { void handleSave() }}
                            >
                                {t('settings.webTools.save')}
                            </Button>
                        </FooterRow>
                    </>
                )}
            </Card>
        </Wrap>
    )
}
