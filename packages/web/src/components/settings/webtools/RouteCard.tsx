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

import { Select, theme as antTheme } from 'antd'
import { useTranslation } from 'react-i18next'
import { Search, FileText } from 'lucide-react'
import styled from '@emotion/styled'
import type { RedactedWebToolsConfig, WebToolProviderId } from '@mobi/shared'
import { SettingsCard } from '@/components/settings/blocks/shared'

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
    /** 即时保存：null = 显式清除该路由（allowClear），返回是否成功（失败提示由上层负责） */
    onChange: (next: { searchProviderId?: WebToolProviderId | null; fetchProviderId?: WebToolProviderId | null }) => Promise<boolean>
}

// 卡片：共享 SettingsCard 扩展路由卡自身节奏（gap/内边距）
const Card = styled(SettingsCard)<{ $token: Token }>`
    gap: 4px;
    padding: 18px ${p => p.$token.padding}px;
`

const Title = styled.span<{ $token: Token }>`
    font-weight: 600;
    font-size: 14px;
    letter-spacing: -0.01em;
    color: ${p => p.$token.colorText};
    margin-bottom: 10px;
`

// 路由行：icon + 文案 + code pill + 右侧 Select
const Row = styled.div`
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 5px 0;
`

const RowIcon = styled.span<{ $token: Token }>`
    display: grid;
    place-items: center;
    flex-shrink: 0;
    color: ${p => p.$token.colorText};
    opacity: 0.6;
`

const RowLabel = styled.span<{ $token: Token }>`
    font-size: 13px;
    color: ${p => p.$token.colorText};
`

// 工具名 code pill：等宽字体 + 四级填充底，与代码语言一致的技术感
const ToolPill = styled.code<{ $token: Token }>`
    font-family: ${p => p.$token.fontFamilyCode};
    font-size: 11.5px;
    color: ${p => p.$token.colorTextSecondary};
    background: ${p => p.$token.colorFillQuaternary};
    border-radius: 5px;
    padding: 1.5px 7px;
`

const Hint = styled.span<{ $token: Token }>`
    font-size: 11.5px;
    color: ${p => p.$token.colorTextTertiary};
    line-height: 1.5;
    margin-top: 10px;
`

/**
 * 用途路由卡：web_search / web_fetch 两行下拉直接选已启用 provider，变更即时保存（无保存按钮）。
 * 空 provider 时转引导态（只有标题 + 提示）。Select 支持 allowClear：路由可随时撤销
 * （清除后 runner resolve 回落 null → NO_PROVIDER，mobi 不再拦截该工具）；
 * 单 provider 时切无可切（下拉只有同值项），但清除始终可用——teardown 流程：清路由 → 禁用 provider。
 */
export function RouteCard({ config, enabledIds, saving, onChange }: RouteCardProps) {
    const { token } = useToken()
    const { t } = useTranslation()

    const options = enabledIds.map((id) => ({ value: id, label: t(`settings.webTools.providers.${id}`) }))

    return (
        <Card $token={token}>
            <Title $token={token}>{t('settings.webTools.routeTitle')}</Title>

            {enabledIds.length === 0 ? (
                // 引导态：尚无启用 provider，路由无从选择
                <Hint $token={token}>{t('settings.webTools.routeEmptyHint')}</Hint>
            ) : (
                <>
                    {ROUTES.map(({ key, icon: Icon, tool, labelKey }) => {
                        const value = key === 'search' ? config.searchProviderId : config.fetchProviderId
                        return (
                            <Row key={key}>
                                <RowIcon $token={token}>
                                    <Icon size={15} strokeWidth={2} />
                                </RowIcon>
                                <RowLabel $token={token}>{t(labelKey)}</RowLabel>
                                <ToolPill $token={token}>{tool}</ToolPill>
                                <Select<WebToolProviderId>
                                    size="small"
                                    style={{ marginLeft: 'auto', minWidth: 140 }}
                                    aria-label={t(labelKey)}
                                    value={value}
                                    options={options}
                                    disabled={saving}
                                    allowClear
                                    placeholder={t('settings.webTools.routePlaceholder')}
                                    // antd 清除时 onChange 收到 undefined → 归一为 null（显式清除，区别于「未提及回填现值」）
                                    onChange={(next) => {
                                        void onChange(key === 'search' ? { searchProviderId: next ?? null } : { fetchProviderId: next ?? null })
                                    }}
                                />
                            </Row>
                        )
                    })}
                    <Hint $token={token}>{t('settings.webTools.routeHint')}</Hint>
                </>
            )}
        </Card>
    )
}
