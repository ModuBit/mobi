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
import type { BundledSkillInfo, SkillInfo } from '@mobi/shared'
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
import { installQuery as readInstallQuery, isDirectSkill, isSourceShape } from '@/features/settings/skills/installFlow'
import { useInstallFlow } from '@/features/settings/skills/useInstallFlow'
import { Skeleton } from '@/ui/shadcn/skeleton/skeleton'
import { AdaptiveDialog } from '@/ui/base/interactive/adaptiveDialog/AdaptiveDialog'
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
     *  打字过程零请求；形态由输入内容判定，不靠「输入模式」开关。
     *  弹窗状态机与提交分流全归 useInstallFlow（installFlow reducer，网络/toast 注入自
     *  useSkillsActions）。 */
    const installFlow = useInstallFlow(actions, tab)
    const installQuery = readInstallQuery(installFlow.state)
    const sourceShape = isSourceShape(installQuery)
    const directSkill = isDirectSkill(installFlow.state)
    /** 清单选择段（null = 未拉取） */
    const availableSkills = installFlow.state.available?.skills ?? null
    const installBusy = installFlow.state.installing || installFlow.state.fetching
    const openInstall = () => installFlow.open(tab)

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
                open={installFlow.state.open}
                onOpenChange={next => { if (!next) installFlow.close() }}
                title={t('settings.skills.installTitle')}
                width={560}
                footer={(
                    <>
                        <Button
                            variant="secondary"
                            onClick={() => {
                                // 拉取中：先取消等待（请求仍可能在后台完成，结果按 seq 丢弃），不关弹窗
                                if (installFlow.state.fetching) {
                                    installFlow.cancelFetch()
                                    return
                                }
                                installFlow.close()
                            }}
                        >
                            {installFlow.state.fetching ? t('settings.skills.installCancelFetch') : t('common.cancel')}
                        </Button>
                        <Button
                            variant="primary"
                            loading={installBusy}
                            disabled={availableSkills !== null
                                ? installFlow.state.selected.length === 0
                                : !installQuery && !installFlow.state.target}
                            onClick={() => { void installFlow.submit() }}
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
                            value={installFlow.state.input}
                            onValueChange={installFlow.setInput}
                            placeholder={t('settings.skills.installSearchPlaceholder')}
                            loading={installFlow.state.finding}
                            aria-label={t('settings.skills.installSearchLabel')}
                            onKeyDown={event => {
                                if (event.key === 'Enter') {
                                    event.preventDefault()
                                    void installFlow.submit()
                                }
                            }}
                            // 前导放大镜即可点：搜索触发不依赖回车（移动端友好），位置在字段内左侧
                            onLeadingClick={() => { void installFlow.submit() }}
                            leadingLabel={sourceShape || installFlow.state.target
                                ? t('settings.skills.installFetch')
                                : t('settings.skills.installSearch')}
                            leadingDisabled={(!installQuery && !installFlow.state.target) || installBusy}
                        />
                        {installFlow.state.target && (
                            <TargetChip $token={token}>
                                <span className="target-name">{installFlow.state.target.label}</span>
                                <span className="target-source">{installFlow.state.target.source}</span>
                                <button
                                    type="button"
                                    aria-label={t('settings.skills.installTargetClear')}
                                    onClick={() => installFlow.clearTarget()}
                                >
                                    <X size={14} aria-hidden="true" />
                                </button>
                            </TargetChip>
                        )}
                        {installFlow.state.findResults !== null && (
                            installFlow.state.findResults.length > 0 ? (
                                <FindResults $token={token}>
                                    {installFlow.state.findResults.map(hit => (
                                        <button
                                            key={`${hit.source}:${hit.skillId}`}
                                            type="button"
                                            onClick={() => installFlow.pickFound(hit)}
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
                            value={installFlow.state.scope}
                            onValueChange={installFlow.setScope}
                            options={promptOptions}
                            allowClear={false}
                        />
                        {/* 克隆仓库可能耗时数十秒：明确进度提示，避免像卡死；此时底部取消 =
                            取消等待（不关弹窗） */}
                        {installFlow.state.fetching && <Hint $token={token}>{t('settings.skills.installFetching')}</Hint>}
                        {availableSkills !== null && (
                            availableSkills.every(s => s.installed) ? (
                                <Hint $token={token}>{t('settings.skills.installAllInstalled')}</Hint>
                            ) : (
                                <SkillOptions $token={token}>
                                    {availableSkills.map(s => (
                                        <div key={s.name} className="skill-option">
                                            <Checkbox
                                                checked={s.installed || installFlow.state.selected.includes(s.name)}
                                                disabled={s.installed}
                                                onCheckedChange={() => installFlow.toggleSkill(s.name)}
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
