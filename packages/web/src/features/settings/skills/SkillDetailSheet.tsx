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
 * skill 详情 sheet（全端统一 BottomSheet，先例 ToolDetailDrawer）：点击列表行展开——
 * 头部（图标 + 名 + 描述 + 启停开关）/ SKILL.md 正文全量滚动 / 元数据区（有才显示）/
 * 操作区（更新 tracked、卸载 deletable——ConfirmMorph 就地确认，不在 sheet 上叠弹层）。
 * 头部即时渲染行数据（不等人）；正文与扩展元数据由 useSkillDetail 按需请求
 * （sheet 关闭 → name 置 null → 请求停发）。sheet 本体即滚动区，正文不再限高内滚。
 */
import { theme as antTheme } from 'antd'
import { BookOpen, RefreshCw, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import styled from '@emotion/styled'
import type { SkillFrontmatterMeta, SkillInfo } from '@mobi/shared'
import { isSkillShadowed } from '@mobi/shared'
import { BottomSheet } from '@/ui/base/interactive/bottom-sheet/BottomSheet'
import { sheetClass } from '@/ui/base/layout/sheetSurface'
import { Markdown } from '@/ui/base/markdown/Markdown'
import { Switch } from '@/ui/shadcn/switch/switch'
import { Button } from '@/ui/base/interactive/button/Button'
import { ConfirmMorph } from '@/ui/base/interactive/confirm-morph/ConfirmMorph'
import { Skeleton } from '@/ui/shadcn/skeleton/skeleton'
import { useSkillDetail } from '@/core/data/hooks/queries/useSkills'

const { useToken } = antTheme
type Token = ReturnType<typeof useToken>['token']

const Body = styled.div`
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 0 16px 16px;
`

/** 头部：图标 + 名 + 描述 + 启停开关（行数据即时渲染，不等人） */
const Head = styled.div<{ $token: Token }>`
    display: flex;
    gap: 10px;
    align-items: flex-start;

    > svg {
        flex-shrink: 0;
        margin-top: 2px;
        color: ${p => p.$token.colorTextSecondary};
    }
`

const HeadText = styled.div`
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1;
`

const Name = styled.div<{ $token: Token }>`
    font-size: 16px;
    font-weight: 600;
    color: ${p => p.$token.colorText};
`

const Desc = styled.div<{ $token: Token }>`
    font-size: 13px;
    color: ${p => p.$token.colorTextSecondary};
    line-height: 1.5;
`

/** 分区小标题 */
const SectionTitle = styled.div<{ $token: Token }>`
    font-size: 12px;
    font-weight: 500;
    color: ${p => p.$token.colorTextTertiary};
`

/** 元数据键值行（左灰右深，整行无值即隐藏） */
const MetaRow = styled.div<{ $token: Token }>`
    display: flex;
    justify-content: space-between;
    gap: 12px;
    font-size: 12px;
    padding: 6px 0;
    border-bottom: 1px solid ${p => p.$token.colorBorderSecondary};

    &:last-child { border-bottom: none; }
`

const MetaKey = styled.span<{ $token: Token }>`
    color: ${p => p.$token.colorTextTertiary};
    flex-shrink: 0;
`

const MetaValue = styled.span<{ $token: Token }>`
    color: ${p => p.$token.colorText};
    text-align: right;
    /* 按词断行（break-all 会把英文断在词中间，whenToUse 长句不可读） */
    word-break: normal;
    overflow-wrap: anywhere;
`

/** 操作区：与正文以 hairline 分隔的操作条（表单 footer 惯例，右对齐、等高 sm 档） */
const Actions = styled.div<{ $token: Token }>`
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 10px;
    padding-top: 12px;
    border-top: 1px solid ${p => p.$token.colorBorderSecondary};
`

/** 元数据行构建：undefined 字段整行不出现（「有才显示」收拢在此一处） */
function metaRows(meta: SkillFrontmatterMeta, t: (k: string, opts?: Record<string, unknown>) => string): { key: string; value: string }[] {
    const rows: { key: string; value: string }[] = []
    if (meta.whenToUse) rows.push({ key: t('settings.skills.detail.whenToUse'), value: meta.whenToUse })
    if (meta.userInvocable === false) rows.push({ key: t('settings.skills.detail.invocation'), value: t('settings.skills.detail.invocationClaudeOnly') })
    if (meta.argumentHint) rows.push({ key: t('settings.skills.detail.argumentHint'), value: meta.argumentHint })
    if (meta.arguments?.length) rows.push({ key: t('settings.skills.detail.arguments'), value: meta.arguments.join(', ') })
    if (meta.paths?.length) rows.push({ key: t('settings.skills.detail.paths'), value: meta.paths.join(', ') })
    if (meta.model) rows.push({ key: t('settings.skills.detail.model'), value: meta.model })
    if (meta.effort) rows.push({ key: t('settings.skills.detail.effort'), value: meta.effort })
    if (meta.fork) {
        rows.push({ key: t('settings.skills.detail.fork'), value: meta.agent ? t('settings.skills.detail.forkAgent', { agent: meta.agent }) : t('settings.skills.detail.forkPlain') })
        // background 只在 fork 语境有意义；显式 false = 等待结果（缺省 true 后台跑，不带值）
        if (meta.background === false) rows.push({ key: t('settings.skills.detail.background'), value: t('settings.skills.detail.backgroundWait') })
    }
    if (meta.license) rows.push({ key: t('settings.skills.detail.license'), value: meta.license })
    if (meta.compatibility) rows.push({ key: t('settings.skills.detail.compatibility'), value: meta.compatibility })
    return rows
}

export interface SkillDetailSheetProps {
    /** 行数据（头部即时显示；null = sheet 关闭态） */
    skill: SkillInfo | null
    /** 当前 scope（详情请求与启停动作共用） */
    scope: string
    open: boolean
    onClose: () => void
    /** 启停（overrideable 行传入）；未传 = 只读行头部无开关 */
    onToggle?: (enabled: boolean) => void
    toggling?: boolean
    /** 更新（tracked 行传入） */
    onUpdate?: () => void
    updating?: boolean
    /** 卸载（deletable 行传入；ConfirmMorph 就地确认后调用，返回 true 关 sheet） */
    onDelete?: () => Promise<boolean>
    deleting?: boolean
}

export function SkillDetailSheet({ skill, scope, open, onClose, onToggle, toggling, onUpdate, updating, onDelete, deleting }: SkillDetailSheetProps) {
    const { token } = useToken()
    const { t } = useTranslation()

    if (!skill) return null

    return (
        // 不传可见 title（居中标题与头部名字重复）；sr-only title 供读屏（回落是通用「面板」，
        // dialog 无障碍名应为技能名）
        <BottomSheet
            open={open}
            onClose={onClose}
            peek={false}
            title={<span className={sheetClass.srOnly}>{skill.name}</span>}
        >
            <SkillDetailContent
                skill={skill}
                scope={scope}
                token={token}
                t={t}
                onToggle={onToggle}
                toggling={toggling}
                onUpdate={onUpdate}
                updating={updating}
                onDelete={onDelete}
                deleting={deleting}
            />
        </BottomSheet>
    )
}

/** 内容装配（hooks 归此层：BottomSheet 是否挂载不影响 hook 调用律） */
function SkillDetailContent({ skill, scope, token, t, onToggle, toggling, onUpdate, updating, onDelete, deleting }: {
    skill: SkillInfo
    scope: string
    token: Token
    t: (k: string, opts?: Record<string, unknown>) => string
    onToggle?: (enabled: boolean) => void
    toggling?: boolean
    onUpdate?: () => void
    updating?: boolean
    onDelete?: () => Promise<boolean>
    deleting?: boolean
}) {
    const { detail, isLoading } = useSkillDetail(skill.name, scope)
    // 以 detail 请求返回的行数据为准（与列表同源、键挂 skillsRoot——sheet 内启停后
    // mutation 失效重拉，头部开关/遮蔽态即时刷新；请求未回来前用行数据兜底渲染）
    const current = detail?.skill ?? skill
    const shadowed = isSkillShadowed(current)
    const rows = metaRows(detail?.meta ?? {}, t)
    const hasActions = Boolean(onUpdate) || Boolean(onDelete)

    return (
        <Body>
            <Head $token={token}>
                <BookOpen size={18} />
                <HeadText>
                    <Name $token={token}>{current.name}</Name>
                    {current.description && <Desc $token={token}>{current.description}</Desc>}
                </HeadText>
                {onToggle && (
                    <div onClick={e => e.stopPropagation()} role="presentation">
                        <Switch
                            checked={current.effectiveState !== 'off'}
                            disabled={toggling}
                            onCheckedChange={onToggle}
                            aria-label={t('settings.skills.toggleAria', { name: current.name })}
                        />
                    </div>
                )}
            </Head>
            {shadowed && <Desc $token={token}>{t('settings.skills.state.shadowed')}</Desc>}

            {rows.length > 0 && (
                <>
                    <SectionTitle $token={token}>{t('settings.skills.detail.meta')}</SectionTitle>
                    <div>
                        {rows.map(r => (
                            <MetaRow key={r.key} $token={token}>
                                <MetaKey $token={token}>{r.key}</MetaKey>
                                <MetaValue $token={token}>{r.value}</MetaValue>
                            </MetaRow>
                        ))}
                    </div>
                </>
            )}

            {/* 正文不加小标题：sheet 里唯一的大块内容，标题是冗余（元数据区标题保留） */}
            {isLoading ? (
                <Skeleton lines={5} label={t('common.loading')} />
            ) : (
                <Markdown content={detail?.body ?? ''} />
            )}

            {hasActions && (
                <Actions $token={token}>
                    {onUpdate && (
                        <Button variant="secondary" size="sm" onClick={onUpdate} loading={updating}>
                            <RefreshCw size={13} />
                            {t('settings.skills.detail.update')}
                        </Button>
                    )}
                    {onDelete && (
                        <ConfirmMorph
                            label={t('settings.skills.detail.delete')}
                            icon={<Trash2 size={13} />}
                            prompt={skill.tracked
                                ? t('settings.skills.deleteConfirmTracked', { source: skill.installSource ?? '' })
                                : t('settings.skills.deleteConfirmUntracked')}
                            pendingLabel={t('common.loading')}
                            onConfirm={onDelete}
                            disabled={deleting}
                            variant="raised"
                        />
                    )}
                </Actions>
            )}
        </Body>
    )
}
