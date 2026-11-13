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
 * skill 列表行（skill-mgmt 票 02–05）：ManageRow 槽位结构上的语义皮肤——
 * 来源/渠道/调用性徽标 + 生效态 + 启停开关 + 更新/删除入口。
 * 开关只在 overrideable 行出现（插件/内置行只读语义由该字段承载）；更新只在 tracked 行
 * （渠道语义归 skills CLI）；删除只对 mobi 自管来源（personal/project）开放——synced 下次
 * 同步会拉回、plugin 归迭代 3；交互编排归 useSkillsActions。
 */
import { theme as antTheme } from 'antd'
import { RefreshCw, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import styled from '@emotion/styled'
import type { SkillInfo, SkillSource } from '@mobi/shared'
import { isSkillShadowed } from '@mobi/shared'
// uiarc 自管件（antd Switch 迁移）：行右槽启停
import { Switch } from '@/ui/shadcn/switch/switch'
import { IconButton } from '@/ui/base/interactive/IconButton'
import { ManageRow, ManageRowTag } from '@/features/settings/blocks/ManageRow'

const { useToken } = antTheme
type Token = ReturnType<typeof useToken>['token']

/** 状态徽标：生效态 off / 被更高层遮蔽（右槽，语义色） */
const StateBadge = styled.span<{ $token: Token; $warn: boolean }>`
    font-size: 11px;
    line-height: 1;
    padding: 3px 8px;
    border-radius: var(--radius-square);
    white-space: nowrap;
    color: ${p => (p.$warn ? p.$token.colorWarning : p.$token.colorTextTertiary)};
    background: ${p => (p.$warn ? p.$token.colorWarningBg : p.$token.colorFillQuaternary)};
`

const SOURCE_TAG_KEY: Record<SkillSource, string> = {
    personal: 'settings.skills.source.personal',
    synced: 'settings.skills.source.synced',
    project: 'settings.skills.source.project',
    plugin: 'settings.skills.source.plugin',
}

export interface SkillRowProps {
    skill: SkillInfo
    /** 启停回调（仅 overrideable 行传入）；未传 = 只读行无开关 */
    onToggle?: (enabled: boolean) => void
    /** 开关请求进行中（单行级，避免整列表闪烁） */
    toggling?: boolean
    /** 更新回调（仅 tracked 行传入）；未传 = 行无更新入口 */
    onUpdate?: () => void
    /** 更新请求进行中 */
    updating?: boolean
    /** 删除回调（仅 personal/project 行传入）；未传 = 行无删除入口 */
    onDelete?: () => void
}

export function SkillRow({ skill, onToggle, toggling = false, onUpdate, updating = false, onDelete }: SkillRowProps) {
    const { token } = useToken()
    const { t } = useTranslation()

    const off = skill.effectiveState === 'off'
    // 遮蔽：归属层没关却被更高层关了——用户在此层开关不会生效（isSkillShadowed 单源）
    const shadowed = isSkillShadowed(skill)

    return (
        <ManageRow
            name={skill.name}
            description={skill.description}
            // 生效态 off 整行弱化（遮蔽行保留对比度：它的可操作性与表象不同）
            opacity={off && !shadowed ? 0.55 : 1}
            data-skill-name={skill.name}
            badges={
                <>
                    <ManageRowTag>{t(SOURCE_TAG_KEY[skill.source])}</ManageRowTag>
                    {skill.installSource && (
                        <ManageRowTag>{t('settings.skills.trackedFrom', { source: skill.installSource })}</ManageRowTag>
                    )}
                    {skill.modelInvocationDisabled && (
                        <ManageRowTag>{t('settings.skills.modelOnly')}</ManageRowTag>
                    )}
                </>
            }
            right={
                <>
                    {shadowed && <StateBadge $token={token} $warn>{t('settings.skills.state.shadowed')}</StateBadge>}
                    {!shadowed && off && <StateBadge $token={token} $warn={false}>{t('settings.skills.state.off')}</StateBadge>}
                    {onToggle && (
                        <Switch
                            checked={!off}
                            disabled={toggling}
                            onCheckedChange={onToggle}
                            aria-label={t('settings.skills.toggleAria', { name: skill.name })}
                        />
                    )}
                    {onUpdate && (
                        <IconButton
                            icon={<RefreshCw size={14} />}
                            size={26}
                            loading={updating}
                            tooltip={t('settings.skills.updateTooltip')}
                            aria-label={t('settings.skills.updateAria', { name: skill.name })}
                            data-skill-update={skill.name}
                            onClick={onUpdate}
                        />
                    )}
                    {onDelete && (
                        <IconButton
                            icon={<Trash2 size={14} />}
                            danger
                            size={26}
                            tooltip={t('settings.skills.deleteTooltip')}
                            aria-label={t('settings.skills.deleteAria', { name: skill.name })}
                            data-skill-delete={skill.name}
                            onClick={onDelete}
                        />
                    )}
                </>
            }
        />
    )
}
