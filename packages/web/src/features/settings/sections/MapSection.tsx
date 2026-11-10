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
import { Alert, Tag, theme as antTheme } from 'antd'
import { useTranslation } from 'react-i18next'
import styled from '@emotion/styled'
import type { MapMode, MapSettingsView } from '@mobi/shared'
import { Button } from '@/ui/base/interactive/button/Button'
import { enter } from '@/features/settings/blocks/shared'
import { useMapSettings } from '@/core/data/hooks/queries/useMapSettings'
import { SettingGroupCard } from '@/features/settings/blocks/SettingGroupCard'
import { SettingRow } from '@/features/settings/blocks/SettingRow'
import { useSettingsDraft } from '@/features/settings/useSettingsDraft'

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

/** 地图草稿形状：三个 key 都是 write-only 待覆盖草稿（留空 = 保持已存值，无回显基线） */
type MapDraft = {
    jsApiKey: string
    securityJsCode: string
    webServiceKey: string
}

/**
 * 地图提交内容构造（batch 整组语义所在）：
 * - 保存（key=''）：非空 = 覆盖、留空 = 保持——只携带非空 trim 值（空 patch 恒提交，
 *   对齐既有「保存恒可点」语义）；三 key 必须整组一次提交，逐字段落盘会产生半配置中间态
 * - 清除（key='clear'）：显式提交全空串（在场性协议：空串 = 清除）
 */
function buildMapPayload(key: string, draft: MapDraft): Record<string, string> {
    if (key === 'clear') return { jsApiKey: '', securityJsCode: '', webServiceKey: '' }
    const patch: Record<string, string> = {}
    if (draft.jsApiKey.trim()) patch.jsApiKey = draft.jsApiKey.trim()
    if (draft.securityJsCode.trim()) patch.securityJsCode = draft.securityJsCode.trim()
    if (draft.webServiceKey.trim()) patch.webServiceKey = draft.webServiceKey.trim()
    return patch
}

/**
 * 地图设置分区（SettingRow 行式形态，提交策略 = batch）：全站唯一保留**局部保存**的分区。
 * 草稿纪律由 useSettingsDraft 承载（写后清空输入框、失败呈现覆写为 inline 状态而非 toast），
 * 分区只声明 buildMapPayload 与保存/清除两个提交入口。
 * 渲染档位由 daemon 推导后回显，前端不重复判定逻辑。
 */
export function MapSection() {
    const { token } = useToken()
    const { t } = useTranslation()
    const { settings, offline, loaded, saving, save } = useMapSettings()
    const [status, setStatus] = useState<'idle' | 'saved' | 'failed'>('idle')

    const draftApi = useSettingsDraft<MapDraft, MapSettingsView>({
        loaded,
        settings: settings ?? undefined,
        errorFallbackKey: 'settings.map.saveFailed',
        fields: {
            jsApiKey: { from: () => '', onSaved: ({ reset }) => reset('') },
            securityJsCode: { from: () => '', onSaved: ({ reset }) => reset('') },
            webServiceKey: { from: () => '', onSaved: ({ reset }) => reset('') },
        },
        buildPayload: (key, draft) => buildMapPayload(key, draft),
        save,
        // 结果呈现是 inline 状态（组内操作行旁），覆写默认 toast
        reportError: () => setStatus('failed'),
        onCommitSuccess: () => setStatus('saved'),
    })

    const mode = settings?.mode ?? 'none'
    const modeLabel = t(`settings.map.mode${mode.charAt(0).toUpperCase()}${mode.slice(1)}`)

    const onSave = () => {
        setStatus('idle')
        void draftApi.commit()
    }

    const onClear = () => {
        setStatus('idle')
        void draftApi.commit('clear', { jsApiKey: '', securityJsCode: '', webServiceKey: '' })
    }

    const field = (
        key: keyof MapDraft,
        labelKey: string,
        hintKey: string,
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
                input={{ ...draftApi.bindInput(key), placeholder, autoComplete: 'off' }}
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
                {field('jsApiKey', 'settings.map.jsApiKeyLabel', 'settings.map.jsApiKeyHint', false)}
                {field('securityJsCode', 'settings.map.securityJsCodeLabel', 'settings.map.securityJsCodeHint', true)}
                {field('webServiceKey', 'settings.map.webServiceKeyLabel', 'settings.map.webServiceKeyHint', true)}
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
