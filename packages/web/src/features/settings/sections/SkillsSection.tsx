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
 * 列表/内置分组/安装弹窗。结构（tabs+内容区）归 ScopeTabbedSection
 * （架构深化候选②），页级动作（安装）经 settingsHeaderSlot 挂到页题行，
 * 四套动作编排归 useSkillsActions（候选⑧）；
 * 数据视角由 daemon 承载（global=个人+synced+插件携带；工作区 tab=该项目 skill）。
 */
import { useMemo, useRef, useState } from 'react'
import { theme as antTheme } from 'antd'
import { Plus, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import styled from '@emotion/styled'
import { SKILL_SCOPE_BUNDLED, SKILL_SCOPE_GLOBAL, skillNameKey } from '@mobi/shared'
import type { BundledSkillInfo, SkillAvailableInfo, SkillInfo, SkillRegistrySkill } from '@mobi/shared'
import { useWorkspaces } from '@/core/data/hooks/queries/useWorkspaces'
import { useBundledSkills, useSkillOccupancy, useSkills } from '@/core/data/hooks/queries/useSkills'
import { Button } from '@/ui/base/interactive/button/Button'
import { SearchField } from '@/ui/base/interactive/search-field/SearchField'
import { Combobox } from '@/ui/base/interactive/combobox/Combobox'
import { Checkbox } from '@/ui/shadcn/checkbox/checkbox'
import { SettingGroupCard } from '@/features/settings/blocks/SettingGroupCard'
import { SettingsHeaderActions } from '@/features/settings/blocks/settingsHeaderSlot'
import { ScopeTabbedSection } from '@/features/settings/blocks/ScopeTabbedSection'
import { useScopeOptions } from '@/features/settings/blocks/useScopeOptions'
import { SkillRow } from '@/features/settings/skills/SkillRow'
import { BundledSkillRow } from '@/features/settings/skills/BundledSkillRow'
import { SkillDetailSheet } from '@/features/settings/skills/SkillDetailSheet'
import { useSkillsActions } from '@/features/settings/skills/useSkillsActions'
import { Skeleton } from '@/ui/shadcn/skeleton/skeleton'
import { AdaptiveDialog } from '@/ui/base/interactive/adaptiveDialog/AdaptiveDialog'
import { HoverGlideLayer } from '@/ui/base/motion/GlideLayer'

/** 安装目标（搜索结果点选）：source = owner/repo，skillId = 目录 slug（skills 包的 skillFilter） */
interface InstallTarget {
    source: string
    skillId?: string
    label: string
}

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

    /* 只命中表单自己的字段标题（直接子级）。曾用后代选择器 span, label——会钻进
       Checkbox 等嵌入组件的内部标记，把勾选字形（--control-glyph）和标题/描述
       排版一起覆盖成正文色：dark 档白勾压白块不可见、两档描述都失去弱化层级
       （2026-11-17 真机） */
    > span, > label {
        font-size: 13px;
        color: ${p => p.$token.colorText};
    }

    > label {
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

/** 已选安装目标（搜索结果点选）：名称 + 来源 + 清除，避免用户忘了自己在装什么 */
const TargetChip = styled.div<{ $token: Token }>`
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    padding: 8px 10px;
    border: 1px solid ${p => p.$token.colorBorderSecondary};
    border-radius: var(--radius-control-sm);
    background: ${p => p.$token.colorFillQuaternary};

    .target-name {
        font-size: 13px;
        font-weight: 500;
        color: ${p => p.$token.colorText};
    }

    .target-source {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 12px;
        color: ${p => p.$token.colorTextTertiary};
    }

    button {
        display: grid;
        place-items: center;
        width: 24px;
        height: 24px;
        flex: 0 0 auto;
        border: none;
        border-radius: var(--radius-control-sm);
        background: transparent;
        color: ${p => p.$token.colorTextTertiary};
        cursor: pointer;

        &:hover {
            background: ${p => p.$token.colorBgTextHover};
            color: ${p => p.$token.colorText};
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

    /** 个人视角名单的名字键集合（内置行同名遮蔽判定：用户胜；与 daemon 扫描层同一 nameKey 规则） */
    const listedNames = useMemo(() => new Set(personalSkills.map(s => skillNameKey(s.name))), [personalSkills])

    /** 安装弹窗：单个输入框兼做「生态搜索 / 来源填写」——
     *  · 纯关键词 → 搜 skills.sh（显式触发：字段内搜索钮 / 底部主钮 / 回车）
     *  · `owner/repo` → 拉整仓清单，多选后安装
     *  · `owner/repo@skill` → 直装该 skill，不再拉整仓清单（skills 包的 skillFilter 语义）
     *  打字过程零请求；形态由输入内容判定，不靠「输入模式」开关。 */
    const [installOpen, setInstallOpen] = useState(false)
    const [installInput, setInstallInput] = useState('')
    const [installScope, setInstallScope] = useState(SKILL_SCOPE_GLOBAL)
    /** 搜索结果点选出的目标（携带目录 slug）：chip 呈现，清空即回到输入态 */
    const [installTarget, setInstallTarget] = useState<InstallTarget | null>(null)
    /** 整仓清单（非 null = 选择段）；已装项（含全局已装，生效态并集）勾上 readonly */
    const [availableSkills, setAvailableSkills] = useState<SkillAvailableInfo[] | null>(null)
    const [selectedSkills, setSelectedSkills] = useState<string[]>([])
    /** 生态搜索结果（null = 未搜过） */
    const [findResults, setFindResults] = useState<SkillRegistrySkill[] | null>(null)
    /** 清单拉取的本地等待标记：取消后立刻复位；请求仍在后台时按 seq 丢弃其结果 */
    const [awaitingFetch, setAwaitingFetch] = useState(false)
    const fetchSeqRef = useRef(0)

    const installQuery = installInput.trim()
    /** 形态判定与 skills 包 parseSource 同形：含 `/` 即来源（owner/repo…） */
    const sourceShape = /^[^\s/]+\/[^\s/]+/.test(installQuery)
    const directSkillShape = /^[^\s/]+\/[^\s/@]+@[^\s]+$/.test(installQuery)
    const targetSource = installTarget
        ? `${installTarget.source}${installTarget.skillId ? `@${installTarget.skillId}` : ''}`
        : installQuery
    const directSkill = installTarget ? Boolean(installTarget.skillId) : directSkillShape
    const installBusy = actions.installing || awaitingFetch

    const openInstall = () => {
        setInstallScope(tab)
        setInstallInput('')
        setInstallTarget(null)
        setAvailableSkills(null)
        setSelectedSkills([])
        setFindResults(null)
        setAwaitingFetch(false)
        setInstallOpen(true)
    }

    /** 生态搜索（显式触发；失败保留上次结果） */
    const runFind = async () => {
        if (!installQuery || sourceShape || actions.finding) return
        const results = await actions.find(installQuery)
        if (results) setFindResults(results)
    }

    /** 点选搜索结果：直接锁定该 skill 为目标（内部 owner/repo@skillId），不再拉整仓清单 */
    const pickFound = (hit: SkillRegistrySkill) => {
        setInstallTarget({ source: hit.source, skillId: hit.skillId, label: hit.name })
        setInstallInput('')
        setFindResults(null)
        setAvailableSkills(null)
        setSelectedSkills([])
    }

    /** 拉整仓清单（可取消：取消后 seq 失效，结果到达也不落到 UI） */
    const fetchAvailableFor = async (source: string): Promise<SkillAvailableInfo[] | null> => {
        const seq = ++fetchSeqRef.current
        setAwaitingFetch(true)
        try {
            const skills = await actions.fetchAvailable(source, installScope)
            if (seq !== fetchSeqRef.current) return null
            return skills
        } finally {
            if (seq === fetchSeqRef.current) setAwaitingFetch(false)
        }
    }

    const cancelFetch = () => {
        fetchSeqRef.current += 1
        setAwaitingFetch(false)
    }

    /** 主动作按形态分流：选择段提交 / 单 skill 直装 / 整仓拉清单 / 关键词搜索 */
    const submitInstall = async () => {
        if (installBusy) return
        if (availableSkills !== null) {
            if (selectedSkills.length === 0) return
            if (await actions.install(targetSource, installScope, selectedSkills)) setInstallOpen(false)
            return
        }
        if (directSkill) {
            if (!targetSource) return
            // skills 包按 source 里的 skillFilter 只装这一个（skills 参数缺省 = skillFilter）
            if (await actions.install(targetSource, installScope)) setInstallOpen(false)
            return
        }
        if (!sourceShape) {
            await runFind()
            return
        }
        const skills = await fetchAvailableFor(installQuery)
        if (!skills) return
        const only = skills.length === 1 && !skills[0].installed && !skills[0].conflict ? skills[0] : null
        if (only) {
            if (await actions.install(installQuery, installScope, [only.name])) setInstallOpen(false)
            return
        }
        setAvailableSkills(skills)
        setSelectedSkills(skills.filter(s => !s.installed).map(s => s.name))
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
            {/* 页级动作进标题行（PC 落点由 SettingsPage 提供；移动端就地右对齐渲染） */}
            <SettingsHeaderActions>
                <Button variant="ghost" size="sm" onClick={openInstall} data-testid="skills-install">
                    <Plus size={13} />
                    {t('settings.skills.installAction')}
                </Button>
            </SettingsHeaderActions>
            <ScopeTabbedSection
                options={tabOptions}
                activeScope={tab}
                onScopeChange={setTab}
                tabsTestId="skills-tabs"
                tabsAriaLabel={t('settings.skills.tabsAria')}
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
                ) : bundled.length > 0 ? (
                    <SettingGroupCard>
                        {bundled.map(b => (
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
                            {t('settings.skills.emptyBundled')}
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
                ) : skills.length > 0 ? (
                    <SettingGroupCard>
                        {skills.map(skill => (
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
                            {t('settings.skills.empty')}
                        </EmptyHint>
                    </SettingGroupCard>
                )}
                </ListArea>
            </ScopeTabbedSection>
            <AdaptiveDialog
                open={installOpen}
                onOpenChange={next => { if (!next) setInstallOpen(false) }}
                title={t('settings.skills.installTitle')}
                width={560}
                footer={(
                    <>
                        <Button
                            variant="secondary"
                            onClick={() => {
                                // 拉取中：先取消等待（请求仍可能在后台完成，结果按 seq 丢弃），不关弹窗
                                if (awaitingFetch) {
                                    cancelFetch()
                                    return
                                }
                                setInstallOpen(false)
                            }}
                        >
                            {awaitingFetch ? t('settings.skills.installCancelFetch') : t('common.cancel')}
                        </Button>
                        <Button
                            variant="primary"
                            loading={installBusy}
                            disabled={availableSkills !== null
                                ? selectedSkills.length === 0
                                : !installQuery && !installTarget}
                            onClick={() => { void submitInstall() }}
                        >
                            {availableSkills !== null
                                ? t('settings.skills.installSubmit')
                                : directSkill
                                    ? t('settings.skills.installDirect')
                                    : sourceShape
                                        ? t('settings.skills.installFetch')
                                        : t('settings.skills.installSearch')}
                        </Button>
                    </>
                )}
                body={(
                    <FormBody $token={token}>
                        {/* 单输入兼做搜索与来源：打字零请求；动作显式触发（字段内搜索钮 / 底部主钮 /
                            回车），移动端不依赖回车 */}
                        <Hint $token={token}>{t('settings.skills.installSearchHint')}</Hint>
                        <SearchField
                            id="skills-install-query"
                            value={installInput}
                            onValueChange={value => {
                                setInstallInput(value)
                                // 重新打字 = 换目标：搜索结果点选锁定的 chip 让位（否则提交仍按旧目标装）
                                if (value) setInstallTarget(null)
                                setFindResults(null)
                                setAvailableSkills(null)
                                setSelectedSkills([])
                            }}
                            placeholder={t('settings.skills.installSearchPlaceholder')}
                            loading={actions.finding}
                            aria-label={t('settings.skills.installSearchLabel')}
                            onKeyDown={event => {
                                if (event.key === 'Enter') {
                                    event.preventDefault()
                                    void submitInstall()
                                }
                            }}
                            // 前导放大镜即可点：搜索触发不依赖回车（移动端友好），位置在字段内左侧
                            onLeadingClick={() => { void submitInstall() }}
                            leadingLabel={sourceShape || installTarget
                                ? t('settings.skills.installFetch')
                                : t('settings.skills.installSearch')}
                            leadingDisabled={(!installQuery && !installTarget) || installBusy}
                        />
                        {installTarget && (
                            <TargetChip $token={token}>
                                <span className="target-name">{installTarget.label}</span>
                                <span className="target-source">{installTarget.source}</span>
                                <button
                                    type="button"
                                    aria-label={t('settings.skills.installTargetClear')}
                                    onClick={() => {
                                        setInstallTarget(null)
                                        setAvailableSkills(null)
                                        setSelectedSkills([])
                                    }}
                                >
                                    <X size={14} aria-hidden="true" />
                                </button>
                            </TargetChip>
                        )}
                        {findResults !== null && (
                            findResults.length > 0 ? (
                                <FindResults $token={token}>
                                    {findResults.map(hit => (
                                        <button
                                            key={`${hit.source}:${hit.skillId}`}
                                            type="button"
                                            onClick={() => pickFound(hit)}
                                        >
                                            <span className="find-name">{hit.name}</span>
                                            <span className="find-meta">
                                                {hit.source} · {t('settings.skills.findInstalls', { installs: hit.installs.toLocaleString() })}
                                            </span>
                                        </button>
                                    ))}
                                </FindResults>
                            ) : (
                                <Hint $token={token}>{t('settings.skills.findEmpty')}</Hint>
                            )
                        )}
                        <Combobox
                            label={t('settings.skills.installScopeLabel')}
                            value={installScope}
                            onValueChange={value => {
                                setInstallScope(value)
                                setAvailableSkills(null)
                            }}
                            options={promptOptions}
                            allowClear={false}
                        />
                        {/* 克隆仓库可能耗时数十秒：明确进度提示，避免像卡死；此时底部取消 =
                            取消等待（不关弹窗） */}
                        {awaitingFetch && <Hint $token={token}>{t('settings.skills.installFetching')}</Hint>}
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
                )}
            />
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
