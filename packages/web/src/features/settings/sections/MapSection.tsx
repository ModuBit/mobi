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
import { Alert, Tag, theme as antTheme } from 'antd'
import { useTranslation } from 'react-i18next'
import styled from '@emotion/styled'
import type { MapMode } from '@mobi/shared'
import { Button } from '@/ui/base/interactive/button/Button'
import { enter } from '@/features/settings/blocks/shared'
import { useMapSettings } from '@/core/data/hooks/queries/useMapSettings'
import { SettingGroupCard } from '@/features/settings/blocks/SettingGroupCard'
import { SettingRow } from '@/features/settings/blocks/SettingRow'

const { useToken } = antTheme
type Token = ReturnType<typeof useToken>['token']

const Wrap = styled.div`
    display: flex;
    flex-direction: column;
    gap: 14px;
    animation: ${enter} 0.25s ease-out;
`

const MODE_VARIANT: Record<MapMode, 'success' | 'warning' | 'default'> = {
    interactive: 'success',
    static: 'warning',
    none: 'default',
}

/** 局部保存操作区（组内行）：保存 + 清除全部 + 结果提示 */
const SaveActions = styled.div`
    display: flex;
    align-items: center;
    gap: 8px;
`

const StatusHint = styled.span<{ $token: Token }>`
    font-size: 12px;
    color: ${p => p.$token.colorTextTertiary};
`

/**
 * 地图设置分区（SettingRow 行式形态，票06）：三个 key 的在场性协议——
 * 非空 = 覆盖，留空 = 保持已存值；「清除全部」显式提交空串。
 * 三 key 需批量提交（留空保持语义无法按行失焦拆分），是唯一保留**局部保存**的分区：
 * 保存/清除收进组内操作行，页尾全局保存按钮不复存在。
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
            <SettingRow
                label={t(labelKey)}
                description={t(hintKey)}
                variant="input"
                secret={secret}
                input={{ value, onChange, placeholder, autoComplete: 'off' }}
            />
        )
    }

    return (
        <Wrap>
            {offline ? <Alert type="warning" showIcon message={t('settings.map.offline')} /> : null}
            <SettingGroupCard title={t('settings.map.title')}>
                <SettingRow
                    label={t('settings.map.modeLabel')}
                    description={t('settings.map.modeHint')}
                    variant="value"
                    value={loaded ? <Tag color={MODE_VARIANT[mode]}>{modeLabel}</Tag> : undefined}
                />
                {field('jsApiKey', 'settings.map.jsApiKeyLabel', 'settings.map.jsApiKeyHint', jsApiKey, (e) => setJsApiKey(e.target.value), false)}
                {field('securityJsCode', 'settings.map.securityJsCodeLabel', 'settings.map.securityJsCodeHint', securityJsCode, (e) => setSecurityJsCode(e.target.value), true)}
                {field('webServiceKey', 'settings.map.webServiceKeyLabel', 'settings.map.webServiceKeyHint', webServiceKey, (e) => setWebServiceKey(e.target.value), true)}
                {/* 局部保存操作行：无 label 的组内操作区（页尾全局保存按钮不复存在） */}
                <div style={{ padding: '10px 16px 14px' }}>
                    <SaveActions>
                        <Button variant="secondary" size="sm" onClick={onSave} loading={saving} disabled={!loaded}>
                            {t('settings.map.save')}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={onClear} disabled={!loaded || saving}>
                            {t('settings.map.clear')}
                        </Button>
                        {status === 'saved' ? <StatusHint $token={token}>{t('settings.map.saved')}</StatusHint> : null}
                        {status === 'failed' ? <StatusHint $token={token}>{t('settings.map.saveFailed')}</StatusHint> : null}
                    </SaveActions>
                </div>
            </SettingGroupCard>
        </Wrap>
    )
}
