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
import { ChevronRight } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import styled from '@emotion/styled'
import { useMediaQuery } from '@/core/data/hooks/useMediaQuery'
import { SETTINGS_WIDE_QUERY } from './registry'
import { NotificationsSection } from './NotificationsSection'
import { SETTINGS_SECTIONS } from './registry'
import { WebToolsStatusBadge } from './WebToolsStatusBadge'

const { useToken } = antTheme
type Token = ReturnType<typeof useToken>['token']

const List = styled.div`
    display: flex;
    flex-direction: column;
    gap: 14px;
`

const EntryCard = styled.button<{ $token: Token }>`
    display: flex;
    align-items: center;
    gap: 14px;
    background: ${p => p.$token.colorBgContainer};
    border: 1px solid ${p => p.$token.colorBorderSecondary};
    border-radius: 12px;
    padding: 16px;
    cursor: pointer;
    text-align: left;
    &:focus-visible {
        outline: 2px solid ${p => p.$token.colorPrimary};
        outline-offset: 2px;
    }
`

const IconBox = styled.span<{ $token: Token }>`
    width: 38px;
    height: 38px;
    border-radius: 10px;
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: ${p => p.$token.colorFillQuaternary};
    color: ${p => p.$token.colorTextSecondary};
`

const EntryText = styled.span`
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
`

const EntryTitle = styled.span<{ $token: Token }>`
    font-size: 14.5px;
    font-weight: 600;
    color: ${p => p.$token.colorText};
`

const EntrySub = styled.span<{ $token: Token }>`
    font-size: 12px;
    color: ${p => p.$token.colorTextTertiary};
`

/** Web 工具状态徽标已提取为 WebToolsStatusBadge（单文件单职责，PC 导航与 mobile 入口共用） */

/**
 * /settings index 分流：PC（≥992px）渲染默认分区（通知），mobile 渲染分组入口列表。
 * 入口 = registry 分区清单；声明了 badge 的分区副标题位显示实时状态徽标。
 */
export function SettingsIndex() {
    const { token } = useToken()
    const { t } = useTranslation()
    const navigate = useNavigate()
    const isWide = useMediaQuery(SETTINGS_WIDE_QUERY)

    if (isWide) return <NotificationsSection />

    const sections = SETTINGS_SECTIONS.filter((s) => s.visible())
    return (
        <List>
            {sections.map((s) => {
                const Icon = s.icon
                return (
                    <EntryCard
                        key={s.id}
                        $token={token}
                        onClick={() => {
                            void navigate({ to: `/settings/${s.id}` })
                        }}
                    >
                        <IconBox $token={token}>
                            <Icon size={19} opacity={0.8} />
                        </IconBox>
                        <EntryText>
                            <EntryTitle $token={token}>{t(s.titleKey)}</EntryTitle>
                            <EntrySub $token={token}>
                                {s.badge === 'web-tools-status' ? <WebToolsStatusBadge /> : t(s.descKey)}
                            </EntrySub>
                        </EntryText>
                        <ChevronRight size={16} color={token.colorTextQuaternary} />
                    </EntryCard>
                )
            })}
        </List>
    )
}
