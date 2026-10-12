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

import { theme as antTheme } from 'antd'
import { useTranslation } from 'react-i18next'
import { useWebToolsStatus, type WebToolsStatus } from '@/core/data/hooks/queries/useWebToolsStatus'

const { useToken } = antTheme

/** 徽标 i18n key 显式映射（避免与状态值的首字母大写拼接隐式耦合） */
const STATUS_BADGE_KEYS: Record<Exclude<WebToolsStatus, 'loading'>, string> = {
    enabled: 'settings.sections.webTools.statusEnabled',
    unconfigured: 'settings.sections.webTools.statusUnconfigured',
    offline: 'settings.sections.webTools.statusOffline',
}

export interface WebToolsStatusBadgeProps {
    /**
     * full = mobile 入口副标题位（loading 回退 desc 占位防卡片高度跳动，各状态均显示文案）；
     * compact = PC 分区导航项右侧（只显示"已启用"绿点，其余态不渲染保持导航干净）
     */
    variant?: 'full' | 'compact'
}

/** Web 工具状态徽标：enabled 绿点 + 文案；其余灰文案（compact 态不渲染） */
export function WebToolsStatusBadge({ variant = 'full' }: WebToolsStatusBadgeProps) {
    const { token } = useToken()
    const { t } = useTranslation()
    const status = useWebToolsStatus()

    if (status === 'loading') {
        return variant === 'full' ? <>{t('settings.sections.webTools.desc')}</> : null
    }
    if (variant === 'compact' && status !== 'enabled') return null
    const key = STATUS_BADGE_KEYS[status]
    const on = status === 'enabled'
    return (
        <span
            style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 12,
                marginLeft: variant === 'compact' ? 'auto' : undefined,
                color: on ? token.colorSuccessText : token.colorTextTertiary,
            }}
        >
            {on && (
                <span
                    style={{
                        width: 5,
                        height: 5,
                        borderRadius: '50%',
                        background: token.colorSuccess,
                    }}
                />
            )}
            {t(key)}
        </span>
    )
}
