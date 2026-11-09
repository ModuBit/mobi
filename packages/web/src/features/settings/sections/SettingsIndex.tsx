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
import { Input, theme as antTheme } from 'antd'
import { useTranslation } from 'react-i18next'
import { Search } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import styled from '@emotion/styled'
import { SETTINGS_SECTIONS, groupedSettingsSections, filterSettingsSections } from './registry'
import { WebToolsStatusBadge } from './WebToolsStatusBadge'
import { SettingGroupCard } from '@/features/settings/blocks/SettingGroupCard'
import { SettingRow } from '@/features/settings/blocks/SettingRow'

const { useToken } = antTheme
type Token = ReturnType<typeof useToken>['token']

/** 底部悬浮搜索需避让的净空：搜索框高度 + 间距 + safe-area */
const FLOATING_SEARCH_CLEARANCE = 76

const Wrap = styled.div<{ $token: Token }>`
    display: flex;
    flex-direction: column;
    gap: 18px;
    /* 底部净空 = 悬浮搜索框 + safe-area（搜索框 fixed 不占流） */
    padding-bottom: calc(${FLOATING_SEARCH_CLEARANCE}px + env(safe-area-inset-bottom));
`

const GroupList = styled.div`
    display: flex;
    flex-direction: column;
    gap: 18px;
`

const EmptyHint = styled.div<{ $token: Token }>`
    padding: 12px 4px;
    font-size: 13px;
    color: ${p => p.$token.colorTextTertiary};
`

/** 底部悬浮搜索（ChatGPT 移动端设置首页形态）：圆角胶囊浮在视口底部 */
const FloatingSearch = styled.div<{ $token: Token }>`
    position: fixed;
    left: 50%;
    transform: translateX(-50%);
    bottom: max(12px, calc(env(safe-area-inset-bottom) + 8px));
    width: min(420px, calc(100% - 24px));
    z-index: 10;
    border-radius: var(--radius-pill);
    background: ${p => p.$token.colorBgContainer};
    border: 1px solid ${p => p.$token.colorBorderSecondary};
    box-shadow: ${p => `0 4px 16px ${p.$token.colorBgMask}`};
    padding: 4px 8px;
`

/**
 * /settings index（mobile 专属）：PC 由路由 beforeLoad「记住上次分区」重定向，落不到这里。
 * ChatGPT 移动端形态：分组无缝圆角卡（行 = icon + 标题 + 右值/chevron）+ 底部悬浮「搜索设置」。
 * 入口 = registry 分组视图；声明了 badge 的分区行右侧显示实时状态徽标。
 */
export function SettingsIndex() {
    const { token } = useToken()
    const { t } = useTranslation()
    const navigate = useNavigate()
    const [keyword, setKeyword] = useState('')

    const sections = SETTINGS_SECTIONS.filter((s) => s.visible())
    const filtered = filterSettingsSections(keyword, sections, (s) => [t(s.titleKey), t(s.descKey)])
    const groups = groupedSettingsSections(filtered)

    return (
        <Wrap $token={token}>
            <GroupList>
                {groups.map((group) => (
                    <SettingGroupCard key={group.id}>
                        {group.sections.map((s) => (
                            <SettingRow
                                key={s.id}
                                label={t(s.titleKey)}
                                icon={s.icon}
                                variant="navigate"
                                value={s.badge === 'web-tools-status' ? <WebToolsStatusBadge /> : undefined}
                                onClick={() => {
                                    void navigate({ to: `/settings/${s.id}` })
                                }}
                            />
                        ))}
                    </SettingGroupCard>
                ))}
                {groups.length === 0 && <EmptyHint $token={token}>{t('settings.searchEmpty')}</EmptyHint>}
            </GroupList>
            <FloatingSearch $token={token}>
                <Input
                    allowClear
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
                    placeholder={t('settings.search')}
                    prefix={<Search size={14} />}
                    variant="borderless"
                    aria-label={t('settings.search')}
                />
            </FloatingSearch>
        </Wrap>
    )
}
