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

import type { GlobalToken } from 'antd/es/theme/interface'

// permission mode tone 到 antd token 颜色的映射
const PERMISSION_TONE_COLORS: Record<string, keyof GlobalToken> = {
    neutral: 'colorTextSecondary',
    info: 'colorInfo',
    warning: 'colorWarning',
    danger: 'colorError',
    success: 'colorSuccess',
}

/** 根据 tone 获取对应的 antd token 颜色值 */
export function getPermissionModeColor(token: GlobalToken, tone: string | null | undefined): string | undefined {
    if (!tone) return undefined
    const key = PERMISSION_TONE_COLORS[tone]
    if (!key) return undefined
    const value = token[key]
    return typeof value === 'string' ? value : undefined
}
