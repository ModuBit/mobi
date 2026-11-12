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
 * 设置页 Skills 分区（skill-mgmt 票 02–05）：tabs（全局 + 每工作区）+ 搜索 + 列表
 * + 启停开关 + 更新/删除 + 安装弹窗。
 * 数据视角由 daemon 承载（global=个人+synced+插件携带；工作区 tab=该项目 skill）；
 * tabs 容器与行布局为迭代 2/3（mcp/plugin 管理页）预留同构骨架。
 */
import { useMemo, useState } from 'react'
import { App, theme as antTheme, Tabs, Spin, Modal, Radio } from 'antd'
import { Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import styled from '@emotion/styled'
import type { SkillInfo } from '@mobi/shared'
import { useWorkspaces } from '@/core/data/hooks/queries/useWorkspaces'
import { useBundledSkills, useSkillDelete, useSkillInstall, useSkillUpdate, useSkillVisibility, useSkills } from '@/core/data/hooks/queries/useSkills'
import { SearchField } from '@/ui/base/interactive/search-field/SearchField'
import { Button } from '@/ui/base/interactive/button/Button'
import { Input } from '@/ui/base/interactive/input/Input'
import { SettingGroupCard } from '@/features/settings/blocks/SettingGroupCard'
import { SkillRow } from '@/features/settings/skills/SkillRow'
import { BundledSkillRow } from '@/features/settings/skills/BundledSkillRow'

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

/** 分组小标题（内置组与主列表的视觉分隔） */
const GroupTitle = styled.div<{ $token: Token }>`
    font-size: 12px;
    font-weight: 500;
    color: ${p => p.$token.colorTextTertiary};
    padding: 0 2px;
`

/** 安装弹窗表单：纵向排布，antd Modal 默认内衬之外自管间距 */
const InstallForm = styled.div<{ $token: Token }>`
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding-top: 4px;

    span, label {
        font-size: 13px;
        color: ${p => p.$token.colorText};
    }

    label {
        cursor: default;
    }
`

/** 搜索匹配：名字 + 描述，大小写不敏感包含（主列表与内置行共用） */
function filterSkills<T extends { name: string; description?: string }>(skills: T[], keyword: string): T[] {
    const needle = keyword.trim().toLowerCase()
    if (!needle) return skills
    return skills.filter(
        s => s.name.toLowerCase().includes(needle) || (s.description?.toLowerCase().includes(needle) ?? false),
    )
}

export function SkillsSection() {
    const { token } = useToken()
    const { t } = useTranslation()
    const { message, modal } = App.useApp()
    const [tab, setTab] = useState<string>(GLOBAL_TAB)
    const [keyword, setKeyword] = useState('')

    const { data: workspaces } = useWorkspaces()
    const { skills, isLoading } = useSkills(tab)
    const isGlobal = tab === GLOBAL_TAB
    // 内置名单只属全局视角；搜索词也参与内置行过滤
    const { bundled, isLoading: bundledLoading, error: bundledError } = useBundledSkills(isGlobal)
    const visibility = useSkillVisibility()
    const deletion = useSkillDelete()
    const updater = useSkillUpdate()
    const installer = useSkillInstall()

    const filtered = useMemo(() => filterSkills(skills, keyword), [skills, keyword])
    const filteredBundled = useMemo(() => filterSkills(bundled, keyword), [bundled, keyword])
    /** 当前列表里的名字集合（内置行同名遮蔽判定：用户胜） */
    const listedNames = useMemo(() => new Set(skills.map(s => s.name)), [skills])

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

    /** 删除：确认弹窗区分双路径文案；tracked 走 skills CLI（失败透传其输出） */
    const requestDelete = (skill: SkillInfo) => {
        modal.confirm({
            title: t('settings.skills.deleteConfirmTitle', { name: skill.name }),
            content: skill.tracked
                ? t('settings.skills.deleteConfirmTracked', { source: skill.installSource ?? '' })
                : t('settings.skills.deleteConfirmUntracked'),
            okText: t('common.delete'),
            okButtonProps: { danger: true },
            cancelText: t('common.cancel'),
            onOk: async () => {
                try {
                    await deletion.mutateAsync({ name: skill.name, workspaceId: tab })
                    message.success(t('settings.skills.deleted'))
                } catch (error) {
                    // 502 时 daemon 透传 CLI 输出（error.response.data.error），否则通用失败文案
                    const detail = (error as { response?: { data?: { error?: string } } })?.response?.data?.error
                    message.error(detail || t('settings.skills.deleteFailed'))
                }
            },
        })
    }

    /** 更新（tracked 限定）：直接执行 + 行级 loading + 结果 toast */
    const handleUpdate = (skill: SkillInfo) => {
        updater.mutate(
            { name: skill.name, workspaceId: tab },
            {
                onSuccess: () => message.success(t('settings.skills.updated')),
                onError: (error) => {
                    const detail = (error as { response?: { data?: { error?: string } } })?.response?.data?.error
                    message.error(detail || t('settings.skills.updateFailed'))
                },
            },
        )
    }

    /** 安装：弹窗内 source + scope（默认跟随当前 tab），提交 loading 防重复 */
    const [installOpen, setInstallOpen] = useState(false)
    const [installSource, setInstallSource] = useState('')
    const [installScope, setInstallScope] = useState(GLOBAL_TAB)

    const openInstall = () => {
        setInstallScope(tab)
        setInstallSource('')
        setInstallOpen(true)
    }

    const submitInstall = async () => {
        if (!installSource.trim()) return
        try {
            await installer.mutateAsync({ source: installSource.trim(), scope: installScope })
            message.success(t('settings.skills.installed'))
            setInstallOpen(false)
        } catch (error) {
            // 失败保持弹窗开着（来源可改后重试）；502 透传 CLI 输出
            const detail = (error as { response?: { data?: { error?: string } } })?.response?.data?.error
            message.error(detail || t('settings.skills.installFailed'))
        }
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
                tabBarExtraContent={{
                    right: (
                        <Button variant="ghost" size="sm" onClick={openInstall} data-testid="skills-install">
                            <Plus size={13} />
                            {t('settings.skills.installAction')}
                        </Button>
                    ),
                }}
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
                            onUpdate={skill.tracked ? () => handleUpdate(skill) : undefined}
                            updating={updater.isPending && updater.variables?.name === skill.name}
                            onDelete={
                                skill.source === 'personal' || skill.source === 'project'
                                    ? () => requestDelete(skill)
                                    : undefined
                            }
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
            {isGlobal && (bundledLoading ? (
                <CenterSpin><Spin size="small" /></CenterSpin>
            ) : bundledError ? (
                <SettingGroupCard>
                    <EmptyHint $token={token}>{t('settings.skills.bundledFailed')}</EmptyHint>
                </SettingGroupCard>
            ) : filteredBundled.length > 0 && (
                <>
                    <GroupTitle $token={token}>{t('settings.skills.groupBundled')}</GroupTitle>
                    <SettingGroupCard>
                        {filteredBundled.map(b => (
                            <BundledSkillRow key={b.name} skill={b} covered={listedNames.has(b.name)} />
                        ))}
                    </SettingGroupCard>
                </>
            ))}
            <Modal
                title={t('settings.skills.installTitle')}
                open={installOpen}
                onCancel={() => setInstallOpen(false)}
                onOk={() => { void submitInstall() }}
                okText={t('settings.skills.installSubmit')}
                cancelText={t('common.cancel')}
                okButtonProps={{ disabled: !installSource.trim() }}
                confirmLoading={installer.isPending}
                destroyOnHidden
            >
                <InstallForm $token={token}>
                    <label htmlFor="skills-install-source">{t('settings.skills.installSourceLabel')}</label>
                    <Input
                        id="skills-install-source"
                        value={installSource}
                        onChange={e => setInstallSource(e.target.value)}
                        placeholder={t('settings.skills.installSourcePlaceholder')}
                        onPressEnter={() => { void submitInstall() }}
                    />
                    <span>{t('settings.skills.installScopeLabel')}</span>
                    <Radio.Group
                        value={installScope}
                        onChange={e => setInstallScope(e.target.value as string)}
                        options={[
                            { value: GLOBAL_TAB, label: t('settings.skills.tabGlobal') },
                            ...(workspaces ?? []).map(w => ({ value: w.id, label: w.name })),
                        ]}
                    />
                </InstallForm>
            </Modal>
        </Wrap>
    )
}
