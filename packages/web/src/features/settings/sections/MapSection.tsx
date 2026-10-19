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

import { useState, type ChangeEvent } from 'react'
import { Alert, Input, Tag, theme as antTheme } from 'antd'
import { useTranslation } from 'react-i18next'
import styled from '@emotion/styled'
import type { MapMode } from '@mobi/shared'
import { Button } from '@/ui/base/interactive/button/Button'
import { SettingsCard, Field, FieldLabel, Hint, enter } from '@/features/settings/blocks/shared'
import { useMapSettings } from '@/core/data/hooks/queries/useMapSettings'

const { useToken } = antTheme
type Token = ReturnType<typeof useToken>['token']

const Wrap = styled.div`
    display: flex;
    flex-direction: column;
    gap: 14px;
    animation: ${enter} 0.25s ease-out;
`

const Card = styled(SettingsCard)<{ $token: Token }>`
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 18px ${p => p.$token.padding}px;
`

const TitleRow = styled.div`
    display: flex;
    align-items: center;
    gap: 10px;
`

const Title = styled.span<{ $token: Token }>`
    font-weight: 600;
    font-size: 14px;
    letter-spacing: -0.01em;
    color: ${p => p.$token.colorText};
`

const Footer = styled.div`
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
`

const MODE_VARIANT: Record<MapMode, 'success' | 'warning' | 'default'> = {
    interactive: 'success',
    static: 'warning',
    none: 'default',
}

/**
 * 地图设置分区（地图组件票 02）：三个 key 的在场性协议——
 * 非空 = 覆盖，留空 = 保持已存值；「清除全部」显式提交空串。
 * 渲染档位由 daemon 推导后回显，前端不重复判定逻辑。
 */
export function MapSection() {
    const { token } = useToken()
    const { t } = useTranslation()
    const { settings, offline, loaded, saving, save } = useMapSettings()

    const [jsApiKey, setJsApiKey] = useState('')
    const [securityJsCode, setSecurityJsCode] = useState('')
    const [webServiceKey, setWebServiceKey] = useState('')
    const [status, setStatus] = useState<'idle' | 'saved' | 'failed'>('idle')

    const mode = settings?.mode ?? 'none'
    const modeLabel = t(`settings.map.mode${mode.charAt(0).toUpperCase()}${mode.slice(1)}`)

    const submit = async (submission: { jsApiKey?: string; securityJsCode?: string; webServiceKey?: string }) => {
        setStatus('idle')
        const result = await save(submission)
        setStatus(result.ok ? 'saved' : 'failed')
        if (result.ok) {
            setJsApiKey('')
            setSecurityJsCode('')
            setWebServiceKey('')
        }
    }

    const onSave = () => {
        const submission: { jsApiKey?: string; securityJsCode?: string; webServiceKey?: string } = {}
        if (jsApiKey.trim()) submission.jsApiKey = jsApiKey.trim()
        if (securityJsCode.trim()) submission.securityJsCode = securityJsCode.trim()
        if (webServiceKey.trim()) submission.webServiceKey = webServiceKey.trim()
        void submit(submission)
    }

    const onClear = () => {
        void submit({ jsApiKey: '', securityJsCode: '', webServiceKey: '' })
    }

    const field = (
        key: 'jsApiKey' | 'securityJsCode' | 'webServiceKey',
        labelKey: string,
        hintKey: string,
        value: string,
        onChange: (event: ChangeEvent<HTMLInputElement>) => void,
        secret: boolean,
    ) => {
        const configured = key === 'webServiceKey' ? settings?.webServiceKeySet : Boolean(settings?.[key])
        const placeholder = configured ? t('settings.map.setPlaceholder') : t('settings.map.emptyPlaceholder')
        return (
            <Field>
                <FieldLabel $token={token}>{t(labelKey)}</FieldLabel>
                {secret ? (
                    <Input.Password
                        value={value}
                        onChange={onChange}
                        placeholder={placeholder}
                        autoComplete="off"
                    />
                ) : (
                    <Input value={value} onChange={onChange} placeholder={placeholder} autoComplete="off" />
                )}
                <Hint $token={token}>{t(hintKey)}</Hint>
            </Field>
        )
    }

    return (
        <Wrap>
            {offline ? <Alert type="warning" showIcon message={t('settings.map.offline')} /> : null}
            <Card $token={token}>
                <TitleRow>
                    <Title $token={token}>{t('settings.map.title')}</Title>
                    {loaded ? <Tag color={MODE_VARIANT[mode]}>{modeLabel}</Tag> : null}
                </TitleRow>
                <Hint $token={token}>{t('settings.map.modeHint')}</Hint>

                {field('jsApiKey', 'settings.map.jsApiKeyLabel', 'settings.map.jsApiKeyHint', jsApiKey, (e) => setJsApiKey(e.target.value), false)}
                {field('securityJsCode', 'settings.map.securityJsCodeLabel', 'settings.map.securityJsCodeHint', securityJsCode, (e) => setSecurityJsCode(e.target.value), true)}
                {field('webServiceKey', 'settings.map.webServiceKeyLabel', 'settings.map.webServiceKeyHint', webServiceKey, (e) => setWebServiceKey(e.target.value), true)}

                <Footer>
                    <Button variant="primary" onClick={onSave} loading={saving} disabled={!loaded}>
                        {t('settings.map.save')}
                    </Button>
                    <Button variant="ghost" onClick={onClear} disabled={!loaded || saving}>
                        {t('settings.map.clear')}
                    </Button>
                    {status === 'saved' ? <Hint $token={token}>{t('settings.map.saved')}</Hint> : null}
                    {status === 'failed' ? <Hint $token={token}>{t('settings.map.saveFailed')}</Hint> : null}
                </Footer>
            </Card>
        </Wrap>
    )
}
