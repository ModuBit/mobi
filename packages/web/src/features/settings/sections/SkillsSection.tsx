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

/**
 * 设置页 Skills 分区（skill-mgmt 票 02/03）：tabs（全局 + 每工作区）+ 搜索 + 列表 + 启停开关。
 * 数据视角由 daemon 承载（global=个人+synced+插件携带；工作区 tab=该项目 skill）；
 * tabs 容器与行布局为迭代 2/3（mcp/plugin 管理页）预留同构骨架。
 */
import { useMemo, useState } from 'react'
import { App, theme as antTheme, Tabs, Spin } from 'antd'
import { useTranslation } from 'react-i18next'
import styled from '@emotion/styled'
import type { SkillInfo } from '@mobi/shared'
import { useWorkspaces } from '@/core/data/hooks/queries/useWorkspaces'
import { useSkillVisibility, useSkills } from '@/core/data/hooks/queries/useSkills'
import { SearchField } from '@/ui/base/interactive/search-field/SearchField'
import { SettingGroupCard } from '@/features/settings/blocks/SettingGroupCard'
import { SkillRow } from '@/features/settings/skills/SkillRow'

const { useToken } = antTheme
type Token = ReturnType<typeof useToken>['token']

const GLOBAL_TAB = 'global'

const Wrap = styled.div<{ $token: Token }>`
    display: flex;
    flex-direction: column;
    gap: 14px;
`

const EmptyHint = styled.div<{ $token: Token }>`
    padding: 24px 16px;
    font-size: 13px;
    color: ${p => p.$token.colorTextTertiary};
    text-align: center;
`

const CenterSpin = styled.div`
    display: flex;
    justify-content: center;
    padding: 32px 0;
`

/** 搜索匹配：名字 + 描述，大小写不敏感包含 */
function filterSkills(skills: SkillInfo[], keyword: string): SkillInfo[] {
    const needle = keyword.trim().toLowerCase()
    if (!needle) return skills
    return skills.filter(
        s => s.name.toLowerCase().includes(needle) || (s.description?.toLowerCase().includes(needle) ?? false),
    )
}

export function SkillsSection() {
    const { token } = useToken()
    const { t } = useTranslation()
    const { message } = App.useApp()
    const [tab, setTab] = useState<string>(GLOBAL_TAB)
    const [keyword, setKeyword] = useState('')

    const { data: workspaces } = useWorkspaces()
    const { skills, isLoading } = useSkills(tab)
    const visibility = useSkillVisibility()

    const filtered = useMemo(() => filterSkills(skills, keyword), [skills, keyword])

    /** 启停：失败报错；成功后归属层已开但生效仍关 → 更高层压制提示 */
    const handleToggle = (skill: SkillInfo) => (enabled: boolean) => {
        visibility.mutate(
            { name: skill.name, enabled, workspaceId: tab },
            {
                onSuccess: (refreshed) => {
                    if (enabled && refreshed?.effectiveState === 'off') {
                        message.warning(t('settings.skills.shadowedToast'))
                    }
                },
                onError: () => {
                    message.error(t('settings.skills.toggleFailed'))
                },
            },
        )
    }

    const tabItems = useMemo(
        () => [
            { key: GLOBAL_TAB, label: t('settings.skills.tabGlobal') },
            ...(workspaces ?? []).map(w => ({ key: w.id, label: w.name })),
        ],
        [workspaces, t],
    )

    return (
        <Wrap $token={token}>
            <SearchField
                value={keyword}
                onValueChange={setKeyword}
                placeholder={t('settings.skills.searchPlaceholder')}
                aria-label={t('settings.skills.searchPlaceholder')}
            />
            <Tabs
                activeKey={tab}
                onChange={setTab}
                items={tabItems}
                size="small"
                data-testid="skills-tabs"
            />
            {isLoading ? (
                <CenterSpin><Spin size="small" /></CenterSpin>
            ) : filtered.length > 0 ? (
                <SettingGroupCard>
                    {filtered.map(skill => (
                        <SkillRow
                            key={`${skill.source}:${skill.name}`}
                            skill={skill}
                            onToggle={skill.overrideable ? handleToggle(skill) : undefined}
                            toggling={visibility.isPending && visibility.variables?.name === skill.name}
                        />
                    ))}
                </SettingGroupCard>
            ) : (
                <SettingGroupCard>
                    <EmptyHint $token={token}>
                        {t(keyword.trim() ? 'settings.skills.emptyFiltered' : 'settings.skills.empty')}
                    </EmptyHint>
                </SettingGroupCard>
            )}
        </Wrap>
    )
}
