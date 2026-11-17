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
import { useMemo, useRef, useState } from 'react'
import { theme as antTheme, Modal, Radio } from 'antd'
import { FilePlus2, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import styled from '@emotion/styled'
import { SKILL_SCOPE_BUNDLED, SKILL_SCOPE_GLOBAL, skillNameKey } from '@mobi/shared'
import type { BundledSkillInfo, SkillAvailableInfo, SkillInfo, SkillRegistrySkill } from '@mobi/shared'
import { useWorkspaces } from '@/core/data/hooks/queries/useWorkspaces'
import { useBundledSkills, useSkillOccupancy, useSkills } from '@/core/data/hooks/queries/useSkills'
import { filterByNameOrDescription } from '@/domain/filterList'
import { Button } from '@/ui/base/interactive/button/Button'
import { Input } from '@/ui/base/interactive/input/Input'
import { Checkbox } from '@/ui/shadcn/checkbox/checkbox'
import { SettingGroupCard } from '@/features/settings/blocks/SettingGroupCard'
import { ScopeTabbedSection } from '@/features/settings/blocks/ScopeTabbedSection'
import { useScopeOptions } from '@/features/settings/blocks/useScopeOptions'
import { SkillRow } from '@/features/settings/skills/SkillRow'
import { BundledSkillRow } from '@/features/settings/skills/BundledSkillRow'
import { SkillDetailSheet } from '@/features/settings/skills/SkillDetailSheet'
import { useSkillsActions } from '@/features/settings/skills/useSkillsActions'
import { Skeleton } from '@/ui/shadcn/skeleton/skeleton'
import { HoverGlideLayer } from '@/ui/base/motion/GlideLayer'

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

/** 列表加载骨架行：内衬对齐 ManageRow（10px 16px），占位形状对齐行内容（头像+两行文本） */
const SkeletonRow = styled.div`
    padding: 10px 16px;
`

/** 列表容器：滑移底色层（HoverGlideLayer）的定位与指针监听范围 */
const ListArea = styled.div`
    position: relative;
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

/** 选择段复选框列表：uiarc Checkbox 自带 label/description 双行；覆盖警告独立一行警示色 */
const SkillOptions = styled.div<{ $token: Token }>`
    display: flex;
    flex-direction: column;
    gap: 10px;
    max-height: 280px;
    overflow-y: auto;
    padding: 4px 0;

    .skill-option {
        display: flex;
        flex-direction: column;
        gap: 2px;
    }

    .skill-conflict {
        font-size: 12px;
        color: ${p => p.$token.colorWarning};
        padding-left: 30px;
    }
`

/** 生态搜索结果：点选行（名称 + 来源 + 安装数），悬停底色与列表行同款语义 */
const FindResults = styled.div<{ $token: Token }>`
    display: flex;
    flex-direction: column;
    gap: 1px;
    max-height: 220px;
    overflow-y: auto;
    padding: 2px;
    border: 1px solid ${p => p.$token.colorBorderSecondary};
    border-radius: var(--radius-control-sm);

    button {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 1px;
        padding: 8px 10px;
        border: none;
        border-radius: var(--radius-control-sm);
        background: transparent;
        color: inherit;
        font: inherit;
        text-align: left;
        cursor: pointer;

        &:hover {
            background: ${p => p.$token.colorBgTextHover};
        }

        .find-name {
            font-size: 13px;
            color: ${p => p.$token.colorText};
        }

        .find-meta {
            font-size: 12px;
            color: ${p => p.$token.colorTextTertiary};
        }
    }
`

/**
 * 系统视角的插件携带行 → 详情 sheet 兜底行：bundled 行只带名字/描述/插件名，
 * 能力字段全按插件行只读事实补齐（开关/更新/卸载入口由字段派生，全不出现）；
 * 详情请求响应回填后以 daemon 行数据为准。
 */
function bundledRowToSkillInfo(row: BundledSkillInfo): SkillInfo {
    return {
        name: row.name,
        description: row.description,
        source: 'plugin',
        form: 'directory',
        path: '',
        tracked: false,
        overrideable: false,
        deletable: false,
        effectiveState: null,
        effectiveFromLayer: null,
        ownState: null,
        pluginName: row.pluginName,
    }
}

export function SkillsSection() {
    const { token } = useToken()
    const { t } = useTranslation()
    const [tab, setTab] = useState<string>(SKILL_SCOPE_GLOBAL)
    const [keyword, setKeyword] = useState('')
    const listAreaRef = useRef<HTMLDivElement>(null)

    const { data: workspaces } = useWorkspaces()
    const { workspaceIds: occupiedWorkspaceIds } = useSkillOccupancy()
    // bundled 是纯前端视角（数据走 useBundledSkills），不发列表请求
    const isBundled = tab === SKILL_SCOPE_BUNDLED
    const { skills, isLoading } = useSkills(tab, { enabled: !isBundled })
    // bundled 行的同名遮蔽判定基准恒为个人视角名单（bundled tab 下 useSkills 停发）
    const { skills: personalSkills } = useSkills(SKILL_SCOPE_GLOBAL)
    // 内置名单只属系统 tab；搜索词也参与内置行过滤
    const { bundled, isLoading: bundledLoading, error: bundledError } = useBundledSkills(isBundled)
    const actions = useSkillsActions()

    const { tabOptions, promptOptions } = useScopeOptions({
        workspaces,
        occupiedWorkspaceIds,
        bundledLabel: t('settings.skills.tabBundled'),
        personalLabel: t('settings.skills.tabGlobal'),
    })

    const filtered = useMemo(() => filterByNameOrDescription(skills, keyword), [skills, keyword])
    const filteredBundled = useMemo(() => filterByNameOrDescription(bundled, keyword), [bundled, keyword])
    /** 个人视角名单的名字键集合（内置行同名遮蔽判定：用户胜；与 daemon 扫描层同一 nameKey 规则） */
    const listedNames = useMemo(() => new Set(personalSkills.map(s => skillNameKey(s.name))), [personalSkills])

    /** 安装：弹窗内 source + scope（默认跟随当前 tab）→ 获取清单 → 复选框选择（两段复用同一 Modal）。
     *  availableSkills null = 输入段；非 null = 选择段。已装项（含全局已装，生效态并集）勾上 readonly；
     *  同名异源 conflict 行覆盖警告；全部已装时提交钮禁用 */
    const [installOpen, setInstallOpen] = useState(false)
    const [installSource, setInstallSource] = useState('')
    const [installScope, setInstallScope] = useState(SKILL_SCOPE_GLOBAL)
    const [availableSkills, setAvailableSkills] = useState<SkillAvailableInfo[] | null>(null)
    const [selectedSkills, setSelectedSkills] = useState<string[]>([])
    /** 生态搜索（= CLI find）输入段：关键词命中清单（null = 未搜过） */
    const [findQuery, setFindQuery] = useState('')
    const [findResults, setFindResults] = useState<SkillRegistrySkill[] | null>(null)

    const openInstall = () => {
        setInstallScope(tab)
        setInstallSource('')
        setAvailableSkills(null)
        setSelectedSkills([])
        setFindQuery('')
        setFindResults(null)
        setInstallOpen(true)
    }

    const runFind = async () => {
        const query = findQuery.trim()
        if (!query || actions.finding) return
        const results = await actions.find(query)
        if (results) setFindResults(results)
    }

    /** 点选搜索结果：来源带入 + 直达选择段（预勾选命中的那个 skill，其余不默认勾选） */
    const pickFound = async (hit: SkillRegistrySkill) => {
        if (actions.resolving) return
        setInstallSource(hit.source)
        const skills = await actions.fetchAvailable(hit.source, installScope)
        if (!skills) return
        setAvailableSkills(skills)
        // 注册表 name 即 frontmatter 名（安装选择键同源）；skillId 是目录 slug，兜底用
        const target = skills.find(s => s.name === hit.name) ?? skills.find(s => s.name === hit.skillId)
        setSelectedSkills(target && !target.installed ? [target.name] : [])
    }

    /** Modal ok 两段复用：输入段拉清单（失败停留；单 skill 可直接装时跳过选择），
     *  选择段提交安装。Enter 直达通道不受 confirmLoading 约束，进行中早退防并发 */
    const submitInstall = async () => {
        const source = installSource.trim()
        if (!source || actions.installing || actions.resolving) return
        if (availableSkills === null) {
            const skills = await actions.fetchAvailable(source, installScope)
            if (!skills) return
            const only = skills.length === 1 && !skills[0].installed && !skills[0].conflict ? skills[0] : null
            if (only) {
                if (await actions.install(source, installScope, [only.name])) setInstallOpen(false)
                return
            }
            setAvailableSkills(skills)
            setSelectedSkills(skills.filter(s => !s.installed).map(s => s.name))
            return
        }
        if (selectedSkills.length === 0) return
        if (await actions.install(source, installScope, selectedSkills)) setInstallOpen(false)
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

    /** 详情 sheet（点击行展开；scope 跟随打开行所在视角——系统 tab 的插件行走 global，
        daemon detail 端点对 global 视角查不到的插件携带 skill 兜底解析） */
    const [detailSkill, setDetailSkill] = useState<SkillInfo | null>(null)
    const [detailScope, setDetailScope] = useState<string>(SKILL_SCOPE_GLOBAL)
    const [detailOpen, setDetailOpen] = useState(false)

    const openDetail = (skill: SkillInfo, scope: string = tab) => {
        setDetailSkill(skill)
        setDetailScope(scope)
        setDetailOpen(true)
    }

    return (
        <Wrap $token={token}>
            <ScopeTabbedSection
                keyword={keyword}
                onKeywordChange={setKeyword}
                searchPlaceholder={t('settings.skills.searchPlaceholder')}
                options={tabOptions}
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
                <ListArea ref={listAreaRef}>
                    {/* 滑移底色层：hover 最淡一档跨行弹簧滑移（SettingsPage 侧栏同款；可点行才标记 data-glide-row） */}
                    <HoverGlideLayer containerRef={listAreaRef} $background={token.colorBgTextHover} $radius="var(--radius-control-sm)" />
                    {isBundled ? (bundledLoading ? (
                    <SettingGroupCard>
                        {Array.from({ length: 4 }, (_, i) => (
                            <SkeletonRow key={i}>
                                <Skeleton avatar lines={2} label={t('common.loading')} />
                            </SkeletonRow>
                        ))}
                    </SettingGroupCard>
                ) : bundledError ? (
                    <SettingGroupCard>
                        <EmptyHint $token={token}>{t('settings.skills.bundledFailed')}</EmptyHint>
                    </SettingGroupCard>
                ) : filteredBundled.length > 0 ? (
                    <SettingGroupCard>
                        {filteredBundled.map(b => (
                            b.pluginName ? (
                                // 插件携带行：可点进只读详情（行数据经 bundledRowToSkillInfo 兜底，详情响应回填）
                                <SkillRow
                                    key={`plugin:${b.name}`}
                                    skill={bundledRowToSkillInfo(b)}
                                    onOpen={() => openDetail(bundledRowToSkillInfo(b), SKILL_SCOPE_GLOBAL)}
                                />
                            ) : (
                                <BundledSkillRow key={b.name} skill={b} covered={listedNames.has(skillNameKey(b.name))} />
                            )
                        ))}
                    </SettingGroupCard>
                ) : (
                    <SettingGroupCard>
                        <EmptyHint $token={token}>
                            {t(keyword.trim() ? 'settings.skills.emptyFiltered' : 'settings.skills.emptyBundled')}
                        </EmptyHint>
                    </SettingGroupCard>
                )) : isLoading ? (
                    <SettingGroupCard>
                        {Array.from({ length: 4 }, (_, i) => (
                            <SkeletonRow key={i}>
                                <Skeleton avatar lines={2} label={t('common.loading')} />
                            </SkeletonRow>
                        ))}
                    </SettingGroupCard>
                ) : filtered.length > 0 ? (
                    <SettingGroupCard>
                        {filtered.map(skill => (
                            <SkillRow
                                key={`${skill.source}:${skill.name}`}
                                skill={skill}
                                onToggle={skill.overrideable ? (enabled: boolean) => actions.toggle(skill, enabled, tab) : undefined}
                                toggling={actions.isToggling(skill.name)}
                                onOpen={() => openDetail(skill)}
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
                </ListArea>
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
                        options={promptOptions}
                    />
                    <Hint $token={token}>{t('settings.skills.createHint')}</Hint>
                </FormBody>
            </Modal>
            <Modal
                title={t('settings.skills.installTitle')}
                open={installOpen}
                onCancel={() => setInstallOpen(false)}
                onOk={() => { void submitInstall() }}
                okText={availableSkills === null ? t('settings.skills.installFetch') : t('settings.skills.installSubmit')}
                cancelText={t('common.cancel')}
                okButtonProps={{
                    disabled: availableSkills === null
                        ? !installSource.trim()
                        : selectedSkills.length === 0,
                }}
                confirmLoading={actions.installing || actions.resolving}
                destroyOnHidden
            >
                <FormBody $token={token}>
                    {/* 先搜再装：关键词直搜 skills.sh 生态（= CLI find），点选命中项带入来源 */}
                    <label htmlFor="skills-install-find">{t('settings.skills.findLabel')}</label>
                    <Input
                        id="skills-install-find"
                        value={findQuery}
                        onChange={e => setFindQuery(e.target.value)}
                        placeholder={t('settings.skills.findPlaceholder')}
                        onPressEnter={() => { void runFind() }}
                    />
                    {actions.finding && <Hint $token={token}>{t('common.loading')}</Hint>}
                    {!actions.finding && findResults !== null && (
                        findResults.length > 0 ? (
                            <FindResults $token={token}>
                                {findResults.map(hit => (
                                    <button
                                        key={`${hit.source}:${hit.skillId}`}
                                        type="button"
                                        onClick={() => { void pickFound(hit) }}
                                    >
                                        <span className="find-name">{hit.name}</span>
                                        <span className="find-meta">
                                            {hit.source} · {t('settings.skills.findInstalls', { count: hit.installs })}
                                        </span>
                                    </button>
                                ))}
                            </FindResults>
                        ) : (
                            <Hint $token={token}>{t('settings.skills.findEmpty')}</Hint>
                        )
                    )}
                    <Hint $token={token}>{t('settings.skills.findHint')}</Hint>
                    <label htmlFor="skills-install-source">{t('settings.skills.installSourceLabel')}</label>
                    <Input
                        id="skills-install-source"
                        value={installSource}
                        onChange={e => { setInstallSource(e.target.value); setAvailableSkills(null) }}
                        placeholder={t('settings.skills.installSourcePlaceholder')}
                        onPressEnter={() => { void submitInstall() }}
                    />
                    <span>{t('settings.skills.installScopeLabel')}</span>
                    <Radio.Group
                        value={installScope}
                        onChange={e => { setInstallScope(e.target.value as string); setAvailableSkills(null) }}
                        options={promptOptions}
                    />
                    {availableSkills !== null && (
                        availableSkills.every(s => s.installed) ? (
                            <Hint $token={token}>{t('settings.skills.installAllInstalled')}</Hint>
                        ) : (
                            <SkillOptions $token={token}>
                                {availableSkills.map(s => (
                                    <div key={s.name} className="skill-option">
                                        <Checkbox
                                            checked={s.installed || selectedSkills.includes(s.name)}
                                            disabled={s.installed}
                                            onCheckedChange={next => {
                                                setSelectedSkills(prev =>
                                                    next ? [...prev, s.name] : prev.filter(n => n !== s.name))
                                            }}
                                            label={s.name}
                                            description={s.description}
                                        />
                                        {s.conflict && (
                                            <span className="skill-conflict">{t('settings.skills.installConflict')}</span>
                                        )}
                                    </div>
                                ))}
                            </SkillOptions>
                        )
                    )}
                </FormBody>
            </Modal>
            {/* 详情 sheet：动作按行能力字段降级（overrideable/tracked/deletable），卸载走 ConfirmMorph 就地确认 */}
            <SkillDetailSheet
                skill={detailSkill}
                scope={detailScope}
                open={detailOpen}
                onClose={() => setDetailOpen(false)}
                onToggle={detailSkill?.overrideable ? (enabled: boolean) => actions.toggle(detailSkill!, enabled, detailScope) : undefined}
                toggling={detailSkill ? actions.isToggling(detailSkill.name) : false}
                onUpdate={detailSkill?.tracked ? () => actions.update(detailSkill!, detailScope) : undefined}
                updating={detailSkill ? actions.isUpdating(detailSkill.name) : false}
                onDelete={detailSkill?.deletable
                    ? async () => {
                        const ok = await actions.deleteDirect(detailSkill!, detailScope)
                        if (ok) setDetailOpen(false)
                        return ok
                    }
                    : undefined}
                deleting={false}
            />
        </Wrap>
    )
}
