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
import { Alert, App, theme as antTheme } from 'antd'
import { Activity } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import styled from '@emotion/styled'
import type { TelemetrySettingsSubmission } from '@mobi/shared'
import { Button } from '@/ui/base/interactive/button/Button'
import { useTelemetrySettings } from '@/core/data/hooks/queries/useTelemetrySettings'
import { SettingGroupCard } from '@/features/settings/blocks/SettingGroupCard'
import { SettingRow } from '@/features/settings/blocks/SettingRow'

const { useToken } = antTheme
type Token = ReturnType<typeof useToken>['token']

import { enter } from '@/features/settings/blocks/shared'

const Wrap = styled.div`
    display: flex;
    flex-direction: column;
    gap: 14px;
    animation: ${enter} 0.25s ease;
`

/** 生效时机提示（组卡内尾行灰字，恒显） */
const CardHint = styled.div<{ $token: Token }>`
    padding: 2px 16px 12px;
    font-size: 12px;
    line-height: 1.5;
    color: ${p => p.$token.colorTextTertiary};
`

/**
 * 会话遥测子页（SettingRow 行式形态，票07：显式保存页 → 即改即存行式）。
 *
 * 开关动作即落盘（三档位联动规则不变：raw 开→content 连带开、content 关→raw 连带关）；
 * endpoint / 认证头失焦落盘（校验沿用原保存口语义）；部分字段提交由 Submission 协议承载。
 * traces 恒导出（span 只含时延与名称）；内容分档显式知情。「下个新会话生效」语义不变
 * ——daemon spawn 时现读注入 OTEL_* env。
 */
export function TelemetrySection() {
    const { token } = useToken()
    const { t } = useTranslation()
    const { message } = App.useApp()
    const { settings, loaded, offline, save } = useTelemetrySettings()

    // 表单草稿（可变输入——最小标识外状态，非派生对象）
    const [enabled, setEnabled] = useState(false)
    const [endpoint, setEndpoint] = useState('')
    const [includeContent, setIncludeContent] = useState(false)
    const [includeRawApiBodies, setIncludeRawApiBodies] = useState(false)
    const [includeMetrics, setIncludeMetrics] = useState(false)
    // 认证头草稿：OTEL 标准形态字符串 `K=V,K2=V2`（write-only，回读只知 headersSet）
    const [headersDraft, setHeadersDraft] = useState('')
    // 已存基线：失焦落盘只在草稿偏离基线时发请求
    const [endpointBaseline, setEndpointBaseline] = useState('')

    // 加载完成后初始化草稿一次（invalidate 重读不重置——编辑中的草稿不丢，对齐 memory 语义）
    const [initialized, setInitialized] = useState(false)
    useEffect(() => {
        if (!loaded || initialized) return
        setEnabled(settings?.enabled ?? false)
        setEndpoint(settings?.endpoint ?? '')
        setEndpointBaseline(settings?.endpoint ?? '')
        setIncludeContent(settings?.includeContent ?? false)
        setIncludeRawApiBodies(settings?.includeRawApiBodies ?? false)
        setIncludeMetrics(settings?.includeMetrics ?? false)
        setInitialized(true)
    }, [loaded, initialized, settings])

    /** 部分字段落盘，失败统一 toast；返回是否成功 */
    const savePartial = async (patch: TelemetrySettingsSubmission) => {
        const result = await save(patch)
        if (!result.ok) message.error(result.error || t('settings.telemetry.saveFailed'))
        return result.ok
    }

    if (!loaded) {
        return (
            <Wrap>
                {offline && <Alert type="warning" showIcon message={t('settings.telemetry.loadFailed')} />}
                <Placeholder />
            </Wrap>
        )
    }

    /** 认证头草稿解析：`K=V,K2=V2` → record；键值均非空才算合法段 */
    const parseHeadersDraft = (): Record<string, string> | { invalid: true } => {
        const trimmed = headersDraft.trim()
        if (!trimmed) return {}
        const record: Record<string, string> = {}
        for (const pair of trimmed.split(',')) {
            const idx = pair.indexOf('=')
            const k = idx > 0 ? pair.slice(0, idx).trim() : ''
            const v = idx > 0 ? pair.slice(idx + 1).trim() : ''
            if (!k || !v) return { invalid: true }
            record[k] = v
        }
        return record
    }

    /** 总开关：翻转即展开 endpoint 行；落盘保持「enabled 落盘必带有效 endpoint」不变式——
     *  endpoint 未填时只翻转 UI 提示待填，不落盘（防 enabled+空 endpoint 中间态落盘） */
    const switchEnabled = async (next: boolean) => {
        setEnabled(next)
        if (next && !endpoint.trim()) {
            message.warning(t('settings.telemetry.endpointRequired'))
            return
        }
        await savePartial(next ? { enabled: true, endpoint: endpoint.trim() } : { enabled: false })
    }

    /** endpoint 失焦落盘：启用态必填（校验失败不落盘、草稿保持让用户改）；
     *  启用态下一并携带 enabled（覆盖「开关已翻未落盘」的中间态，开启意图随有效地址一起生效） */
    const saveEndpoint = async () => {
        const enabledPending = enabled && !endpointBaseline.trim()
        if (endpoint === endpointBaseline && !enabledPending) return
        if (enabled && !endpoint.trim()) {
            message.error(t('settings.telemetry.endpointRequired'))
            return
        }
        if (await savePartial({ endpoint: endpoint.trim(), ...(enabled ? { enabled: true } : {}) })) {
            setEndpointBaseline(endpoint.trim())
        }
    }

    /** 内容档位开关：动作即落盘（含联动布尔恒显式提交——非敏感布尔无在场性协议） */
    const switchContent = (next: boolean) => {
        // 关闭内容档连带关闭完整请求体档（原联动规则）
        setIncludeContent(next)
        if (!next) setIncludeRawApiBodies(false)
        void savePartial(next ? { includeContent: true } : { includeContent: false, includeRawApiBodies: false })
    }

    const switchRaw = (next: boolean) => {
        // 开启完整请求体档连带开启内容档（原联动规则）
        setIncludeRawApiBodies(next)
        if (next) setIncludeContent(true)
        void savePartial(next ? { includeRawApiBodies: true, includeContent: true } : { includeRawApiBodies: false })
    }

    const switchMetrics = (next: boolean) => {
        setIncludeMetrics(next)
        void savePartial({ includeMetrics: next })
    }

    /** 认证头失焦落盘：非空才校验+携带（在场性协议：不在场 = 保持旧值） */
    const saveHeaders = async () => {
        const trimmed = headersDraft.trim()
        if (!trimmed) return
        const parsed = parseHeadersDraft()
        if ('invalid' in parsed) {
            message.error(t('settings.telemetry.headersInvalid'))
            return
        }
        if (await savePartial({ headers: parsed })) setHeadersDraft('')
    }

    /** 清除已存认证头：显式提交空对象（在场性协议：空对象 = 清除） */
    const clearHeaders = async () => {
        if (await savePartial({ headers: {} })) {
            setHeadersDraft('')
            message.success(t('settings.telemetry.headersCleared'))
        }
    }

    return (
        <Wrap>
            <SettingGroupCard>
                <SettingRow
                    icon={Activity}
                    label={t('settings.telemetry.enabledLabel')}
                    variant="switch"
                    description={t('settings.telemetry.privacyHint')}
                    checked={enabled}
                    onCheckedChange={(v) => { void switchEnabled(v) }}
                />
                {enabled && (
                    <>
                        <SettingRow
                            label={t('settings.telemetry.endpointLabel')}
                            variant="input"
                            input={{
                                value: endpoint,
                                onChange: (e) => setEndpoint(e.target.value),
                                onBlur: () => { void saveEndpoint() },
                                onPressEnter: () => { void saveEndpoint() },
                                placeholder: 'http://localhost:4318',
                            }}
                        />
                        <SettingRow
                            label={t('settings.telemetry.contentLabel')}
                            variant="switch"
                            description={t('settings.telemetry.contentHint')}
                            checked={includeContent}
                            onCheckedChange={switchContent}
                        />
                        <SettingRow
                            label={t('settings.telemetry.rawLabel')}
                            variant="switch"
                            description={t('settings.telemetry.rawHint')}
                            checked={includeRawApiBodies}
                            onCheckedChange={switchRaw}
                        />
                        <SettingRow
                            label={t('settings.telemetry.metricsLabel')}
                            variant="switch"
                            description={t('settings.telemetry.metricsHint')}
                            checked={includeMetrics}
                            onCheckedChange={switchMetrics}
                        />
                        <SettingRow
                            label={t('settings.telemetry.headersLabel')}
                            variant="input"
                            secret
                            description={t('settings.telemetry.headersHint')}
                            input={{
                                value: headersDraft,
                                onChange: (e) => setHeadersDraft(e.target.value),
                                onBlur: () => { void saveHeaders() },
                                onPressEnter: () => { void saveHeaders() },
                                placeholder: settings?.headersSet
                                    ? t('settings.telemetry.headersSetPlaceholder')
                                    : t('settings.telemetry.headersPlaceholder'),
                                autoComplete: 'new-password',
                            }}
                        />
                        {settings?.headersSet && (
                            <SettingRow
                                label={t('settings.telemetry.headersClear')}
                                variant="action"
                                action={
                                    <HeadersClearButton onClick={() => { void clearHeaders() }}>
                                        {t('settings.telemetry.clear')}
                                    </HeadersClearButton>
                                }
                            />
                        )}
                    </>
                )}
                <CardHint $token={token}>{t('settings.telemetry.effectiveNextSession')}</CardHint>
            </SettingGroupCard>
        </Wrap>
    )
}

const HeadersClearButton = styled(Button)`
    padding: 0;
`

/** 空占位：首次加载中保持子页高度，避免布局跳动（对齐 MemorySection 的 Placeholder 语义） */
const Placeholder = styled.div`
    min-height: 200px;
`
