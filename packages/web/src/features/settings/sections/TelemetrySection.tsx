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
 * is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { useEffect, useState } from 'react'
import { Alert, App, Input, Switch, Tag, theme as antTheme } from 'antd'
import { Button } from '@/ui/base/interactive/button/Button'
import { useTranslation } from 'react-i18next'
import { Activity } from 'lucide-react'
import styled from '@emotion/styled'
import type { TelemetrySettingsSubmission } from '@mobi/shared'
import { SettingsCard } from '@/features/settings/blocks/shared'
import { useTelemetrySettings } from '@/core/data/hooks/queries/useTelemetrySettings'

const { useToken } = antTheme
type Token = ReturnType<typeof useToken>['token']

const Wrap = styled.div`
    display: flex;
    flex-direction: column;
    gap: 14px;
    animation: enter 0.25s ease;
`

const Card = styled(SettingsCard)<{ $token: Token }>`
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 18px ${p => p.$token.padding}px;
`

const Title = styled.span<{ $token: Token }>`
    font-weight: 600;
    font-size: 14px;
    letter-spacing: -0.01em;
    color: ${p => p.$token.colorText};
`

const FieldLabel = styled.label<{ $token: Token }>`
    font-size: 13px;
    color: ${p => p.$token.colorText};
    display: block;
    margin-bottom: 6px;
`

const Hint = styled.span<{ $token: Token }>`
    font-size: 11.5px;
    color: ${p => p.$token.colorTextTertiary};
    line-height: 1.5;
    display: block;
`

const Footer = styled.div`
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
`

const EnabledRow = styled.div`
    display: flex;
    align-items: center;
    gap: 10px;
`

/**
 * 会话遥测子页（OpenTelemetry 设置票）：总开关 / OTLP endpoint / 认证头。
 * v1 traces-only（span 不含对话正文；prompt 级 log events 不提供导出）。显式保存
 * （保存后「下个新会话生效」——daemon spawn 时现读注入 OTEL_* env）。
 */
export function TelemetrySection() {
    const { token } = useToken()
    const { t } = useTranslation()
    const { message } = App.useApp()
    const { settings, loaded, offline, saving, save } = useTelemetrySettings()

    // 表单草稿（可变输入——最小标识外状态，非派生对象）
    const [enabled, setEnabled] = useState(false)
    const [endpoint, setEndpoint] = useState('')
    // 认证头草稿：OTEL 标准形态字符串 `K=V,K2=V2`（write-only，回读只知 headersSet）
    const [headersDraft, setHeadersDraft] = useState('')

    // 加载完成后初始化草稿一次（invalidate 重读不重置——编辑中的草稿不丢，对齐 memory 语义）
    const [initialized, setInitialized] = useState(false)
    useEffect(() => {
        if (!loaded || initialized) return
        setEnabled(settings?.enabled ?? false)
        setEndpoint(settings?.endpoint ?? '')
        setInitialized(true)
    }, [loaded, initialized, settings])

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

    const handleSave = async () => {
        if (enabled && !endpoint.trim()) {
            message.error(t('settings.telemetry.endpointRequired'))
            return
        }
        // 认证头在场性协议：草稿非空才携带（undefined = 保持旧值）；解析失败在保存口拦下
        const parsedHeaders = headersDraft.trim() ? parseHeadersDraft() : {}
        if ('invalid' in parsedHeaders) {
            message.error(t('settings.telemetry.headersInvalid'))
            return
        }
        const submission: TelemetrySettingsSubmission = {
            enabled,
            endpoint: endpoint.trim(),
            ...(headersDraft.trim() ? { headers: parsedHeaders } : {}),
        }
        const result = await save(submission)
        if (!result.ok) {
            message.error(result.error || t('settings.telemetry.saveFailed'))
            return
        }
        setHeadersDraft('')
        message.success(t('settings.telemetry.savedHint'))
    }

    /** 清除已存认证头：显式提交空对象（在场性协议：空对象 = 清除） */
    const handleClearHeaders = async () => {
        const result = await save({ headers: {} })
        if (!result.ok) {
            message.error(result.error || t('settings.telemetry.saveFailed'))
        } else {
            setHeadersDraft('')
            message.success(t('settings.telemetry.headersCleared'))
        }
    }

    return (
        <Wrap>
            <Card $token={token}>
                <Title $token={token}>
                    <Activity size={15} style={{ verticalAlign: -2.5, marginRight: 6 }} />
                    {t('settings.telemetry.cardTitle')}
                </Title>
                <EnabledRow>
                    <Switch checked={enabled} onChange={setEnabled} aria-label={t('settings.telemetry.enabledLabel')} />
                    <span style={{ fontSize: 13 }}>{t('settings.telemetry.enabledLabel')}</span>
                </EnabledRow>
                <Hint $token={token}>{t('settings.telemetry.privacyHint')}</Hint>

                {enabled && (
                    <>
                        <div>
                            <FieldLabel $token={token}>{t('settings.telemetry.endpointLabel')}</FieldLabel>
                            <Input
                                value={endpoint}
                                onChange={(e) => setEndpoint(e.target.value)}
                                placeholder="http://localhost:4318"
                                aria-label={t('settings.telemetry.endpointLabel')}
                            />
                        </div>

                        <div>
                            <FieldLabel $token={token}>{t('settings.telemetry.headersLabel')}</FieldLabel>
                            <Input.Password
                                value={headersDraft}
                                onChange={(e) => setHeadersDraft(e.target.value)}
                                placeholder={settings?.headersSet
                                    ? t('settings.telemetry.headersSetPlaceholder')
                                    : t('settings.telemetry.headersPlaceholder')}
                                aria-label={t('settings.telemetry.headersLabel')}
                            />
                            <Hint $token={token}>{t('settings.telemetry.headersHint')}</Hint>
                            {settings?.headersSet && (
                                <Button variant="ghost" size="sm" style={{ marginTop: 4, padding: 0 }}
                                    onClick={() => { void handleClearHeaders() }}>
                                    {t('settings.telemetry.headersClear')}
                                </Button>
                            )}
                        </div>
                    </>
                )}
            </Card>

            <Footer>
                <Button variant="primary" loading={saving} onClick={() => { void handleSave() }}>
                    {t('settings.telemetry.saveButton')}
                </Button>
                {settings?.enabled && <Tag>{t('settings.telemetry.effectiveNextSession')}</Tag>}
            </Footer>
        </Wrap>
    )
}

/** 空占位：首次加载中保持子页高度，避免布局跳动（对齐 MemorySection 的 Placeholder 语义） */
const Placeholder = styled.div`
    min-height: 200px;
`
