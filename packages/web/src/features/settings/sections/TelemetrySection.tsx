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

import { Alert, App, theme as antTheme } from 'antd'
import { Activity } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import styled from '@emotion/styled'
import type { TelemetrySettings, TelemetrySettingsSubmission } from '@mobi/shared'
import { Button } from '@/ui/base/interactive/button/Button'
import { useTelemetrySettings } from '@/core/data/hooks/queries/useTelemetrySettings'
import { SettingGroupCard } from '@/features/settings/blocks/SettingGroupCard'
import { SettingRow } from '@/features/settings/blocks/SettingRow'
import { useSettingsDraft } from '@/features/settings/useSettingsDraft'

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

/** 认证头草稿解析：`K=V,K2=V2` → record；键值均非空才算合法段 */
const parseHeadersDraft = (trimmed: string): Record<string, string> | { invalid: true } => {
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

/**
 * 会话遥测子页（SettingRow 行式形态）。草稿—落盘纪律由 useSettingsDraft 承载
 * （加载投影一次 / 失败 toast / 成功副作用），分区只声明字段投影与提交内容构造：
 *
 * 开关动作即落盘（三档位联动规则不变：raw 开→content 连带开、content 关→raw 连带关）；
 * endpoint / 认证头失焦落盘（校验沿用原保存口语义）；部分字段提交由 Submission 协议承载。
 * 不变式「enabled 落盘必带有效 endpoint」在 buildPayload 内维持（开关已翻未落盘的中间态
 * 由 endpoint 失焦提交时一并携带 enabled 收口）。traces 恒导出（span 只含时延与名称）；
 * 内容分档显式知情。「下个新会话生效」语义不变——daemon spawn 时现读注入 OTEL_* env。
 */
export function TelemetrySection() {
    const { token } = useToken()
    const { t } = useTranslation()
    const { message } = App.useApp()
    const { settings, loaded, offline, save } = useTelemetrySettings()

    const draftApi = useSettingsDraft<TelemetryDraft, TelemetrySettings | null>({
        loaded,
        settings: settings ?? null,
        errorFallbackKey: 'settings.telemetry.saveFailed',
        fields: {
            enabled: { from: (s) => s?.enabled ?? false },
            endpoint: { from: (s) => s?.endpoint ?? '' },
            includeContent: { from: (s) => s?.includeContent ?? false },
            includeRawApiBodies: { from: (s) => s?.includeRawApiBodies ?? false },
            includeMetrics: { from: (s) => s?.includeMetrics ?? false },
            // 认证头草稿：OTEL 标准形态字符串 `K=V,K2=V2`（write-only，回读只知 headersSet），写后清空
            headersDraft: { from: () => '', onSaved: ({ reset }) => reset('') },
        },
        buildPayload: (key, draft, baseline) => buildTelemetryPayload(key, draft, baseline, t),
        save,
    })

    // 认证头已存哨兵（回读只知布尔），清除行走语义动作提交空对象（在场性协议：空对象 = 清除）
    const headersSet = settings?.headersSet ?? false

    if (!loaded) {
        return (
            <Wrap>
                {offline && <Alert type="warning" showIcon message={t('settings.telemetry.loadFailed')} />}
                <Placeholder />
            </Wrap>
        )
    }

    const { draft } = draftApi

    /** 总开关：翻转即展开 endpoint 行；endpoint 未填时只翻转 UI 提示待填，不落盘
     * （防 enabled+空 endpoint 中间态落盘——不变式由 buildPayload 的 enabled 分支维持）。
     * commit 必须带 patchDraft：同一同步序列内 setDraft 尚未 flush，无 patch 会读到 stale 草稿 */
    const switchEnabled = (next: boolean) => {
        if (next && !draft.endpoint.trim()) {
            draftApi.setDraft({ enabled: next })
            message.warning(t('settings.telemetry.endpointRequired'))
            return
        }
        void draftApi.commit('enabled', { enabled: next })
    }

    /** 清除已存认证头 */
    const clearHeaders = () => { void draftApi.commit('headersClear', { headersDraft: '' }) }

    return (
        <Wrap>
            <SettingGroupCard>
                <SettingRow
                    icon={Activity}
                    label={t('settings.telemetry.enabledLabel')}
                    variant="switch"
                    description={t('settings.telemetry.privacyHint')}
                    checked={draft.enabled}
                    onCheckedChange={switchEnabled}
                />
                {draft.enabled && (
                    <>
                        <SettingRow
                            label={t('settings.telemetry.endpointLabel')}
                            variant="input"
                            input={{
                                ...draftApi.bindInput('endpoint'),
                                placeholder: 'http://localhost:4318',
                            }}
                        />
                        <SettingRow
                            label={t('settings.telemetry.contentLabel')}
                            variant="switch"
                            description={t('settings.telemetry.contentHint')}
                            checked={draft.includeContent}
                            onCheckedChange={(v) => { void draftApi.commit('includeContent', {
                                includeContent: v,
                                ...(v ? {} : { includeRawApiBodies: false }),
                            }) }}
                        />
                        <SettingRow
                            label={t('settings.telemetry.rawLabel')}
                            variant="switch"
                            description={t('settings.telemetry.rawHint')}
                            checked={draft.includeRawApiBodies}
                            onCheckedChange={(v) => { void draftApi.commit('includeRawApiBodies', {
                                includeRawApiBodies: v,
                                ...(v ? { includeContent: true } : {}),
                            }) }}
                        />
                        <SettingRow
                            label={t('settings.telemetry.metricsLabel')}
                            variant="switch"
                            description={t('settings.telemetry.metricsHint')}
                            checked={draft.includeMetrics}
                            onCheckedChange={(v) => { void draftApi.commit('includeMetrics', { includeMetrics: v }) }}
                        />
                        <SettingRow
                            label={t('settings.telemetry.headersLabel')}
                            variant="input"
                            secret
                            description={t('settings.telemetry.headersHint')}
                            input={{
                                ...draftApi.bindInput('headersDraft'),
                                placeholder: headersSet
                                    ? t('settings.telemetry.headersSetPlaceholder')
                                    : t('settings.telemetry.headersPlaceholder'),
                                autoComplete: 'new-password',
                            }}
                        />
                        {headersSet && (
                            <SettingRow
                                label={t('settings.telemetry.headersClear')}
                                variant="action"
                                action={
                                    <HeadersClearButton onClick={clearHeaders}>
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

/** 遥测草稿形状（headersDraft 为 write-only 原文草稿，提交时解析成 headers record） */
type TelemetryDraft = {
    enabled: boolean
    endpoint: string
    includeContent: boolean
    includeRawApiBodies: boolean
    includeMetrics: boolean
    headersDraft: string
}

/**
 * 遥测提交内容构造（分区不变式所在，对提交内容有最终决定权）：
 * - enabled 开关：开 = 携带有效 endpoint（不变式「enabled 落盘必带有效 endpoint」，上层已挡空值）；
 *   关 = 只携带 enabled
 * - endpoint 失焦：偏离基线（或 enabled 意图尚待落盘）才提交；启用态必填校验失败返回 error 不落盘；
 *   启用态提交时一并携带 enabled（覆盖「开关已翻未落盘」中间态）
 * - 三档位开关联动：raw 开→content 连带开；content 关→raw 连带关（联动布尔显式提交）
 * - 认证头：非空才解析携带（在场性协议：不在场 = 保持旧值），解析失败返回 error
 */
function buildTelemetryPayload(
    key: string,
    draft: TelemetryDraft,
    baseline: TelemetryDraft,
    t: (k: string) => string,
): TelemetrySettingsSubmission | Record<string, unknown> | null | { error: string } {
    switch (key) {
        case 'enabled':
            return draft.enabled
                ? { enabled: true, endpoint: draft.endpoint.trim() }
                : { enabled: false }
        case 'endpoint': {
            const enabledPending = draft.enabled && !baseline.endpoint.trim()
            if (draft.endpoint === baseline.endpoint && !enabledPending) return null
            if (draft.enabled && !draft.endpoint.trim()) return { error: t('settings.telemetry.endpointRequired') }
            return { endpoint: draft.endpoint.trim(), ...(draft.enabled ? { enabled: true } : {}) }
        }
        case 'includeContent':
            return draft.includeContent
                ? { includeContent: true }
                : { includeContent: false, includeRawApiBodies: false }
        case 'includeRawApiBodies':
            return draft.includeRawApiBodies
                ? { includeRawApiBodies: true, includeContent: true }
                : { includeRawApiBodies: false }
        case 'includeMetrics':
            return { includeMetrics: draft.includeMetrics }
        case 'headersClear':
            // 显式清除：提交空对象（在场性协议：空对象 = 清除）
            return { headers: {} }
        case 'headersDraft': {
            const trimmed = draft.headersDraft.trim()
            if (!trimmed) return null
            const parsed = parseHeadersDraft(trimmed)
            return 'invalid' in parsed ? { error: t('settings.telemetry.headersInvalid') } : { headers: parsed }
        }
        default:
            return null
    }
}

const HeadersClearButton = styled(Button)`
    padding: 0;
`

/** 空占位：首次加载中保持子页高度，避免布局跳动（对齐 MemorySection 的 Placeholder 语义） */
const Placeholder = styled.div`
    min-height: 200px;
`
