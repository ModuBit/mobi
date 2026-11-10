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

import { theme as antTheme } from 'antd'
import { useTranslation } from 'react-i18next'
import { Search, FileText } from 'lucide-react'
import styled from '@emotion/styled'
import type { RedactedWebToolsConfig, WebToolProviderId } from '@mobi/shared'
import { SettingGroupCard } from '@/features/settings/blocks/SettingGroupCard'
import { SettingRow } from '@/features/settings/blocks/SettingRow'

const { useToken } = antTheme

type Token = ReturnType<typeof useToken>['token']

/** 用途路由行定义：工具名 code pill 与 config 字段一一对应 */
const ROUTES = [
    { key: 'search', icon: Search, tool: 'web_search', labelKey: 'settings.webTools.route.search' },
    { key: 'fetch', icon: FileText, tool: 'web_fetch', labelKey: 'settings.webTools.route.fetch' },
] as const

export interface RouteCardProps {
    config: RedactedWebToolsConfig
    /** 已启用的 provider id 列表（下拉可选项） */
    enabledIds: WebToolProviderId[]
    saving: boolean
    /** 意图：设置某用途路由（即时保存；失败提示归上层，返回是否成功） */
    onSetRoute: (slot: 'search' | 'fetch', providerId: WebToolProviderId) => Promise<boolean>
    /** 意图：清除某用途路由（allowClear——清除后 daemon resolve 回落 null → NO_PROVIDER，mobi 不再拦截该工具） */
    onClearRoute: (slot: 'search' | 'fetch') => Promise<boolean>
}

/** 行 label：图标 + 文案 + 工具名 code pill（与代码语言一致的技术感） */
const RouteLabel = styled.span<{ $token: Token }>`
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: ${p => p.$token.colorText};
`

const RouteIcon = styled.span<{ $token: Token }>`
    display: inline-flex;
    color: ${p => p.$token.colorText};
    opacity: 0.6;
`

const ToolPill = styled.code<{ $token: Token }>`
    font-family: ${p => p.$token.fontFamilyCode};
    font-size: 11.5px;
    color: ${p => p.$token.colorTextSecondary};
    background: ${p => p.$token.colorFillQuaternary};
    border-radius: var(--radius-square);
    padding: 1.5px 7px;
`

/** 组卡内灰字说明（首/尾行，与行式形态 CardHint 同语言） */
const CardHint = styled.div<{ $token: Token }>`
    padding: 10px 16px 14px;
    font-size: 11.5px;
    line-height: 1.5;
    color: ${p => p.$token.colorTextTertiary};
`

/**
 * 用途路由卡（SettingRow 行式）：web_search / web_fetch 两行下拉直接选已启用 provider，
 * 变更即时保存（无保存按钮）。空 provider 时转引导态（只有标题 + 提示）。Select 支持 allowClear：
 * 路由可随时撤销——teardown 流程：清路由 → 禁用 provider。
 * 提交构造（路由字段三义性）归 useWebToolsSubmission，本卡只以意图回调说话。
 */
export function RouteCard({ config, enabledIds, saving, onSetRoute, onClearRoute }: RouteCardProps) {
    const { token } = useToken()
    const { t } = useTranslation()

    const options = enabledIds.map((id) => ({ value: id, label: t(`settings.webTools.providers.${id}`) }))

    return (
        <SettingGroupCard title={t('settings.webTools.routeTitle')}>
            {enabledIds.length === 0 ? (
                // 引导态：尚无启用 provider，路由无从选择
                <CardHint $token={token}>{t('settings.webTools.routeEmptyHint')}</CardHint>
            ) : (
                <>
                    {ROUTES.map(({ key, icon: Icon, tool, labelKey }) => {
                        const value = key === 'search' ? config.searchProviderId : config.fetchProviderId
                        return (
                            <SettingRow
                                key={key}
                                label={
                                    <RouteLabel $token={token}>
                                        <RouteIcon $token={token}><Icon size={15} strokeWidth={2} /></RouteIcon>
                                        {t(labelKey)}
                                        <ToolPill $token={token}>{tool}</ToolPill>
                                    </RouteLabel>
                                }
                                variant="inline-select"
                                select={{
                                    value: value ?? "",
                                    options,
                                    disabled: saving,
                                    allowClear: true,
                                    ariaLabel: t(labelKey),
                                    placeholder: t('settings.webTools.routePlaceholder'),
                                    style: { minWidth: 140 },
                                    onValueChange: (next) => {
                                        void onSetRoute(key, next as WebToolProviderId)
                                    },
                                    onClear: () => {
                                        void onClearRoute(key)
                                    },
                                }}
                            />
                        )
                    })}
                    <CardHint $token={token}>{t('settings.webTools.routeHint')}</CardHint>
                </>
            )}
        </SettingGroupCard>
    )
}
