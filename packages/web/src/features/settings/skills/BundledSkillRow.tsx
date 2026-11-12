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
 * CC 内置 bundled skill 行（skill-mgmt 票 06）：纯只读展示——名字 + 描述 + 「内置」徽标，
 * 无开关/更新/删除（bundled 不受 mobi 管理操作管辖）。
 * 与个人 skill 同名时按 CC 规则用户胜，此行加「被同名技能覆盖」徽标提示。
 */
import { theme as antTheme } from 'antd'
import { useTranslation } from 'react-i18next'
import styled from '@emotion/styled'
import type { BundledSkillInfo } from '@mobi/shared'

const { useToken } = antTheme
type Token = ReturnType<typeof useToken>['token']

const Row = styled.div<{ $token: Token }>`
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 16px;
    min-width: 0;
    opacity: 0.75;
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
`

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

const Tag = styled.span<{ $token: Token }>`
    font-size: 11px;
    line-height: 1;
    padding: 3px 7px;
    border-radius: var(--radius-square);
    color: ${p => p.$token.colorTextTertiary};
    background: ${p => p.$token.colorFillQuaternary};
    white-space: nowrap;
`

export interface BundledSkillRowProps {
    skill: BundledSkillInfo
    /** 与当前列表中的个人/项目 skill 同名（CC 规则：用户胜，内置被遮蔽） */
    covered?: boolean
}

export function BundledSkillRow({ skill, covered = false }: BundledSkillRowProps) {
    const { token } = useToken()
    const { t } = useTranslation()

    return (
        <Row $token={token} data-skill-name={skill.name} data-bundled="true">
            <Main>
                <NameRow>
                    <Name $token={token}>{skill.name}</Name>
                    <Tag $token={token}>{t('settings.skills.source.bundled')}</Tag>
                    {covered && <Tag $token={token}>{t('settings.skills.coveredByLocal')}</Tag>}
                </NameRow>
                {skill.description && <Desc $token={token}>{skill.description}</Desc>}
            </Main>
        </Row>
    )
}
