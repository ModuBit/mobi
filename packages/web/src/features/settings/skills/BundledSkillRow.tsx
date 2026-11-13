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
 * CC 内置 bundled skill 行（skill-mgmt 票 06）：ManageRow 上的纯只读皮肤——
 * 名字 + 描述 + 「内置」徽标，无开关/更新/删除（bundled 不受 mobi 管理操作管辖）。
 * 与个人 skill 同名时按 CC 规则用户胜，此行加「被同名技能覆盖」徽标提示。
 */
import { useTranslation } from 'react-i18next'
import type { BundledSkillInfo } from '@mobi/shared'
import { ManageRow, ManageRowTag } from '@/features/settings/blocks/ManageRow'

export interface BundledSkillRowProps {
    skill: BundledSkillInfo
    /** 与当前列表中的个人/项目 skill 同名（CC 规则：用户胜，内置被遮蔽） */
    covered?: boolean
}

export function BundledSkillRow({ skill, covered = false }: BundledSkillRowProps) {
    const { t } = useTranslation()

    return (
        <ManageRow
            name={skill.name}
            description={skill.description}
            // 只读行轻弱化（与可操作行的视觉层级区分）
            opacity={0.75}
            data-skill-name={skill.name}
            data-bundled="true"
            badges={
                <>
                    <ManageRowTag>{t('settings.skills.source.bundled')}</ManageRowTag>
                    {covered && <ManageRowTag>{t('settings.skills.coveredByLocal')}</ManageRowTag>}
                </>
            }
        />
    )
}
