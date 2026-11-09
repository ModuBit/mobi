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

import { useTranslation } from 'react-i18next'
import { Smartphone } from 'lucide-react'
import { usePwaMode } from '@/ui/shared/usePwaMode'
import { InstallButton } from '@/ui/shared/InstallButton'
import { SettingGroupCard } from './SettingGroupCard'
import { SettingRow } from './SettingRow'

/**
 * PWA 安装引导（SettingRow 行式，票05：原虚线卡收敛为分组卡内操作行）。
 * token 由 SettingRow 内部获取；已装 PWA（usePwaMode=true）时不渲染。
 */
export function PwaCard() {
    const { t } = useTranslation()
    const isPwa = usePwaMode()
    if (isPwa) return null
    return (
        <SettingGroupCard>
            <SettingRow
                label={t('notification.settings.installPwa')}
                description={
                    <span style={{ display: 'grid', gap: 2 }}>
                        <span>{t('notification.settings.installPwaDesc')}</span>
                        <span>{t('notification.settings.installPwaIos')}</span>
                    </span>
                }
                icon={Smartphone}
                variant="action"
                action={<InstallButton variant="card" />}
            />
        </SettingGroupCard>
    )
}
