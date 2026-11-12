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
 * skill 列表行（skill-mgmt 票 02/03/04）：名字 + 描述 + 来源/渠道/调用性徽标 + 生效态 + 启停开关 + 删除入口。
 * 开关只在 overrideable 行出现（插件/内置行只读语义由该字段承载）；删除只对 mobi 自管来源
 * （personal/project）开放——synced 下次同步会拉回、plugin 归迭代 3；交互编排归分区层。
 */
import { theme as antTheme } from 'antd'
import { Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import styled from '@emotion/styled'
import type { SkillInfo, SkillSource } from '@mobi/shared'
// uiarc 自管件（antd Switch 迁移）：行右槽启停
import { Switch } from '@/ui/shadcn/switch/switch'
import { IconButton } from '@/ui/base/interactive/IconButton'

const { useToken } = antTheme
type Token = ReturnType<typeof useToken>['token']

const Row = styled.div<{ $token: Token; $dim: boolean }>`
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 16px;
    min-width: 0;

    /* 生效态 off 整行弱化（遮蔽行保留对比度：它的可操作性与表象不同） */
    opacity: ${p => (p.$dim ? 0.55 : 1)};
`

const Main = styled.div`
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
`

const NameRow = styled.div`
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    flex-wrap: wrap;
`;

const Name = styled.span<{ $token: Token }>`
    font-size: 13px;
    font-weight: 500;
    color: ${p => p.$token.colorText};
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
`

const Desc = styled.div<{ $token: Token }>`
    font-size: 12px;
    color: ${p => p.$token.colorTextTertiary};
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
`

/** 徽标：来源 / 渠道 / 调用性（低饱和，不与状态徽标抢视觉） */
const Tag = styled.span<{ $token: Token }>`
    font-size: 11px;
    line-height: 1;
    padding: 3px 7px;
    border-radius: var(--radius-square);
    color: ${p => p.$token.colorTextTertiary};
    background: ${p => p.$token.colorFillQuaternary};
    white-space: nowrap;
`

/** 状态徽标：生效态 off / 被更高层遮蔽（右侧，语义色） */
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

const Right = styled.div`
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
`

export interface SkillRowProps {
    skill: SkillInfo
    /** 启停回调（仅 overrideable 行传入）；未传 = 只读行无开关 */
    onToggle?: (enabled: boolean) => void
    /** 开关请求进行中（单行级，避免整列表闪烁） */
    toggling?: boolean
    /** 删除回调（仅 personal/project 行传入）；未传 = 行无删除入口 */
    onDelete?: () => void
}

export function SkillRow({ skill, onToggle, toggling = false, onDelete }: SkillRowProps) {
    const { token } = useToken()
    const { t } = useTranslation()

    const off = skill.effectiveState === 'off'
    // 遮蔽：归属层没关（on 或无条目）却被更高层关了——用户在此层开关不会生效
    const shadowed = off && skill.ownState !== 'off'

    return (
        <Row $token={token} $dim={off && !shadowed} data-skill-name={skill.name}>
            <Main>
                <NameRow>
                    <Name $token={token}>{skill.name}</Name>
                    <Tag $token={token}>{t(SOURCE_TAG_KEY[skill.source])}</Tag>
                    {skill.installSource && (
                        <Tag $token={token}>{t('settings.skills.trackedFrom', { source: skill.installSource })}</Tag>
                    )}
                    {skill.modelInvocationDisabled && (
                        <Tag $token={token}>{t('settings.skills.modelOnly')}</Tag>
                    )}
                </NameRow>
                {skill.description && <Desc $token={token}>{skill.description}</Desc>}
            </Main>
            <Right>
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
            </Right>
        </Row>
    )
}
