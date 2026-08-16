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

import { App, Switch, theme as antTheme } from 'antd'
import { useTranslation } from 'react-i18next'
import styled from '@emotion/styled'
import { credentialKeysFor } from '@mobi/shared'
import { enter } from '@/components/settings/blocks/shared'
import { CredentialEditor, type ProviderEntry, type VerifyResult } from './CredentialEditor'

const { useToken } = antTheme

type Token = ReturnType<typeof useToken>['token']

export interface ProviderCardProps {
    provider: ProviderEntry
    /** 该 provider 当前承担的用途（search/fetch 路由指向它）——禁用前拦截提示用 */
    referencedBy: ('search' | 'fetch')[]
    /** 展开态受控（由上层持有）：reload 重读配置后编辑器不收起 */
    expanded: boolean
    onExpandedChange: (expanded: boolean) => void
    saving: boolean
    /** 启用开关：返回是否成功（失败提示由上层负责） */
    onToggle: (enabled: boolean) => Promise<boolean>
    onSaveCredentials: (credentials: Record<string, string | null>) => Promise<boolean>
    onVerify: (credentials: Record<string, string>) => Promise<VerifyResult>
}

// 卡片：与路由卡同族；展开态细边框微亮提示层级
const Card = styled.section<{ $token: Token; $expanded: boolean }>`
    display: flex;
    flex-direction: column;
    border-radius: 12px;
    background: ${p => p.$token.colorBgContainer};
    border: 1px solid ${p => (p.$expanded ? p.$token.colorBorder : p.$token.colorBorderSecondary)};
    animation: ${enter} 0.3s ease-out;
`

// 卡头：可点击展开（除 Switch 区域），键盘可达
const Head = styled.div<{ $token: Token }>`
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 16px;
    cursor: pointer;
    user-select: none;

    &:focus-visible {
        outline: 2px solid ${p => p.$token.colorPrimary};
        outline-offset: -2px;
        border-radius: 12px;
    }
`

// Logo 字标：40px 圆角方块，深底反白（品牌字母）
const Logo = styled.span<{ $token: Token }>`
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    flex-shrink: 0;
    border-radius: 10px;
    background: ${p => p.$token.colorText};
    color: ${p => p.$token.colorTextLightSolid};
    font-size: 15px;
    font-weight: 700;
    letter-spacing: -0.02em;
`

const HeadText = styled.div`
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
`

const Name = styled.span<{ $token: Token }>`
    font-weight: 600;
    font-size: 14px;
    letter-spacing: -0.01em;
    color: ${p => p.$token.colorText};
`

const Desc = styled.span<{ $token: Token }>`
    font-size: 12px;
    line-height: 1.5;
    color: ${p => p.$token.colorTextTertiary};
`

// API Key 状态：已设（绿）/未设（灰）
const KeyState = styled.span<{ $token: Token; $set: boolean }>`
    font-size: 12px;
    color: ${p => (p.$set ? p.$token.colorSuccessText : p.$token.colorTextTertiary)};
`

// 开关隔离区：点击不冒泡到卡头（避免开关即展开/收起）
const SwitchArea = styled.span`
    display: inline-flex;
    flex-shrink: 0;
`

// 展开区：内联凭据编辑器（S9 实装）
const Body = styled.div<{ $token: Token }>`
    padding: 0 16px 16px 68px;
    border-top: 1px solid ${p => p.$token.colorBorderSecondary};
`

/**
 * Provider 卡：logo/名称/描述/API Key 状态 + 启用开关外置；点击卡身展开内联凭据编辑器。
 * 禁用预校验：provider 正承担 search/fetch 路由时拒绝关闭（提示先调整路由），不动开关不发 RPC。
 */
export function ProviderCard({ provider, referencedBy, expanded, onExpandedChange, saving, onToggle, onSaveCredentials, onVerify }: ProviderCardProps) {
    const { token } = useToken()
    const { t } = useTranslation()
    const { message } = App.useApp()

    // 展开区容器 id：卡头 aria-controls 关联（无障碍）
    const editorId = `webtools-editor-${provider.id}`
    // 凭据状态：任一凭据键已设置即视为"已设置"（当前 provider 均为单键 apiKey）
    const keySet = credentialKeysFor(provider.id).some((key) => provider.credentials[key]?.set)

    /** 开关切换：关闭被路由引用的 provider 先拦截（写侧也会校验，此处避免必然失败的请求）；失败提示由上层负责 */
    const handleToggle = async (enabled: boolean) => {
        if (!enabled && referencedBy.length > 0) {
            message.warning(
                t('settings.webTools.disableReferenced', {
                    tools: referencedBy.map((r) => t(`settings.webTools.route.${r}`)).join(' / '),
                }),
            )
            return
        }
        await onToggle(enabled)
    }

    const toggleExpanded = () => onExpandedChange(!expanded)

    return (
        <Card $token={token} $expanded={expanded}>
            <Head
                $token={token}
                role="button"
                tabIndex={0}
                aria-expanded={expanded}
                aria-controls={editorId}
                aria-label={t(`settings.webTools.providers.${provider.id}`)}
                onClick={toggleExpanded}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        toggleExpanded()
                    }
                }}
            >
                <Logo $token={token}>{t(`settings.webTools.providerLogo.${provider.id}`)}</Logo>
                <HeadText>
                    <Name $token={token}>{t(`settings.webTools.providers.${provider.id}`)}</Name>
                    <Desc $token={token}>{t(`settings.webTools.providerDesc.${provider.id}`)}</Desc>
                    <KeyState $token={token} $set={keySet}>
                        {keySet
                            ? `${t('settings.webTools.apiKey')} ${t('settings.webTools.credentialSet')}`
                            : t('settings.webTools.credentialUnset')}
                    </KeyState>
                </HeadText>
                <SwitchArea
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                >
                    <Switch
                        size="small"
                        aria-label={`${provider.id}-enabled`}
                        checked={provider.enabled}
                        loading={saving}
                        onChange={(checked) => {
                            void handleToggle(checked)
                        }}
                    />
                </SwitchArea>
            </Head>

            {expanded && (
                <Body $token={token} id={editorId}>
                    <CredentialEditor provider={provider} onSave={onSaveCredentials} onVerify={onVerify} />
                </Body>
            )}
        </Card>
    )
}
