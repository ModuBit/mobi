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
 * 设置页 Skills 分区（skill-mgmt 票 02–07）：scope-tabbed 骨架上的域特有呈现——
 * 列表/内置分组/安装弹窗/新建弹窗。结构（搜索+tabs+动作槽）归 ScopeTabbedSection
 * （架构深化候选②），五套动作编排归 useSkillsActions（候选⑧）；
 * 数据视角由 daemon 承载（global=个人+synced+插件携带；工作区 tab=该项目 skill）。
 */
import { useMemo, useState } from 'react'
import { theme as antTheme, Spin, Modal, Radio } from 'antd'
import { FilePlus2, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import styled from '@emotion/styled'
import { SKILL_SCOPE_GLOBAL, skillNameKey } from '@mobi/shared'
import { useWorkspaces } from '@/core/data/hooks/queries/useWorkspaces'
import { useBundledSkills, useSkills } from '@/core/data/hooks/queries/useSkills'
import { filterByNameOrDescription } from '@/domain/filterList'
import { Button } from '@/ui/base/interactive/button/Button'
import { Input } from '@/ui/base/interactive/input/Input'
import { SettingGroupCard } from '@/features/settings/blocks/SettingGroupCard'
import { ScopeTabbedSection } from '@/features/settings/blocks/ScopeTabbedSection'
import { useScopeOptions } from '@/features/settings/blocks/useScopeOptions'
import { SkillRow } from '@/features/settings/skills/SkillRow'
import { BundledSkillRow } from '@/features/settings/skills/BundledSkillRow'
import { useSkillsActions } from '@/features/settings/skills/useSkillsActions'

const { useToken } = antTheme
type Token = ReturnType<typeof useToken>['token']

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

/** 弹窗表单：纵向排布，antd Modal 默认内衬之外自管间距 */
const FormBody = styled.div<{ $token: Token }>`
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

/** 弹窗内说明文字 */
const Hint = styled.div<{ $token: Token }>`
    font-size: 12px;
    color: ${p => p.$token.colorTextTertiary};
    line-height: 1.6;
`

export function SkillsSection() {
    const { token } = useToken()
    const { t } = useTranslation()
    const [tab, setTab] = useState<string>(SKILL_SCOPE_GLOBAL)
    const [keyword, setKeyword] = useState('')

    const { data: workspaces } = useWorkspaces()
    const { skills, isLoading } = useSkills(tab)
    const isGlobal = tab === SKILL_SCOPE_GLOBAL
    // 内置名单只属全局视角；搜索词也参与内置行过滤
    const { bundled, isLoading: bundledLoading, error: bundledError } = useBundledSkills(isGlobal)
    const actions = useSkillsActions()

    const scopeOptions = useScopeOptions(workspaces, t('settings.skills.tabGlobal'))

    const filtered = useMemo(() => filterByNameOrDescription(skills, keyword), [skills, keyword])
    const filteredBundled = useMemo(() => filterByNameOrDescription(bundled, keyword), [bundled, keyword])
    /** 当前列表的名字键集合（内置行同名遮蔽判定：用户胜；与 daemon 扫描层同一 nameKey 规则） */
    const listedNames = useMemo(() => new Set(skills.map(s => skillNameKey(s.name))), [skills])

    /** 安装：弹窗内 source + scope（默认跟随当前 tab），提交 loading 防重复 */
    const [installOpen, setInstallOpen] = useState(false)
    const [installSource, setInstallSource] = useState('')
    const [installScope, setInstallScope] = useState(SKILL_SCOPE_GLOBAL)

    const openInstall = () => {
        setInstallScope(tab)
        setInstallSource('')
        setInstallOpen(true)
    }

    const submitInstall = async () => {
        if (!installSource.trim()) return
        // Enter 直达通道不受弹窗 confirmLoading 约束，进行中早退防并发安装
        if (actions.installing) return
        // 失败保持弹窗开着（来源可改后重试）
        if (await actions.install(installSource.trim(), installScope)) setInstallOpen(false)
    }

    /** 对话式新建（票 07）：scope 弹窗 → daemon 生成预填 prompt → 跨页草稿通道预填 + 跳新会话页 */
    const [createOpen, setCreateOpen] = useState(false)
    const [createScope, setCreateScope] = useState(SKILL_SCOPE_GLOBAL)

    const openCreate = () => {
        setCreateScope(tab)
        setCreateOpen(true)
    }

    const submitCreate = async () => {
        if (await actions.submitCreate(createScope)) setCreateOpen(false)
    }

    return (
        <Wrap $token={token}>
            <ScopeTabbedSection
                keyword={keyword}
                onKeywordChange={setKeyword}
                searchPlaceholder={t('settings.skills.searchPlaceholder')}
                options={scopeOptions}
                activeScope={tab}
                onScopeChange={setTab}
                tabsTestId="skills-tabs"
                tabsAriaLabel={t('settings.skills.tabsAria')}
                actions={
                    <>
                        <Button variant="ghost" size="sm" onClick={openCreate} data-testid="skills-create">
                            <FilePlus2 size={13} />
                            {t('settings.skills.createAction')}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={openInstall} data-testid="skills-install">
                            <Plus size={13} />
                            {t('settings.skills.installAction')}
                        </Button>
                    </>
                }
            >
                {isLoading ? (
                    <CenterSpin><Spin size="small" /></CenterSpin>
                ) : filtered.length > 0 ? (
                    <SettingGroupCard>
                        {filtered.map(skill => (
                            <SkillRow
                                key={`${skill.source}:${skill.name}`}
                                skill={skill}
                                onToggle={skill.overrideable ? (enabled: boolean) => actions.toggle(skill, enabled, tab) : undefined}
                                toggling={actions.isToggling(skill.name)}
                                onUpdate={skill.tracked ? () => actions.update(skill, tab) : undefined}
                                updating={actions.isUpdating(skill.name)}
                                onDelete={
                                    skill.deletable
                                        ? () => actions.requestDelete(skill, tab)
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
                                <BundledSkillRow key={b.name} skill={b} covered={listedNames.has(skillNameKey(b.name))} />
                            ))}
                        </SettingGroupCard>
                    </>
                ))}
            </ScopeTabbedSection>
            <Modal
                title={t('settings.skills.createTitle')}
                open={createOpen}
                onCancel={() => setCreateOpen(false)}
                onOk={() => { void submitCreate() }}
                okText={t('settings.skills.createSubmit')}
                cancelText={t('common.cancel')}
                confirmLoading={actions.creating}
                destroyOnHidden
            >
                <FormBody $token={token}>
                    <span>{t('settings.skills.createScopeLabel')}</span>
                    <Radio.Group
                        value={createScope}
                        onChange={e => setCreateScope(e.target.value as string)}
                        options={scopeOptions}
                    />
                    <Hint $token={token}>{t('settings.skills.createHint')}</Hint>
                </FormBody>
            </Modal>
            <Modal
                title={t('settings.skills.installTitle')}
                open={installOpen}
                onCancel={() => setInstallOpen(false)}
                onOk={() => { void submitInstall() }}
                okText={t('settings.skills.installSubmit')}
                cancelText={t('common.cancel')}
                okButtonProps={{ disabled: !installSource.trim() }}
                confirmLoading={actions.installing}
                destroyOnHidden
            >
                <FormBody $token={token}>
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
                        options={scopeOptions}
                    />
                </FormBody>
            </Modal>
        </Wrap>
    )
}
