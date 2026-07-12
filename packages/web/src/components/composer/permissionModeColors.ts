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

// neutral 用 antd token（随主题），其余用固定品牌色（对齐 Claude CLI）
const PERMISSION_TONE_TOKEN: Record<string, keyof GlobalToken> = {
    neutral: 'colorTextSecondary',
}

// light/dark 双档（antd 色板 7/5 号）：light 用深档保证对比度，dark 用亮档避免深色沉入背景
const PERMISSION_TONE_FIXED: Record<string, { light: string; dark: string }> = {
    gold:   { light: '#d48806', dark: '#ffc53d' }, // auto
    purple: { light: '#722ed1', dark: '#9254de' }, // acceptEdits
    green:  { light: '#389e0d', dark: '#52c41a' }, // plan
    danger: { light: '#cf1322', dark: '#ff4d4f' }, // dontAsk / yolo
}

/** 根据 colorBgBase 亮度判断当前是否 dark 主题 */
function isDarkTheme(token: GlobalToken): boolean {
    const bg = token.colorBgBase
    if (typeof bg !== 'string' || !bg.startsWith('#')) return false
    const hex = bg.slice(1)
    if (hex.length !== 6) return false
    const r = parseInt(hex.slice(0, 2), 16) / 255
    const g = parseInt(hex.slice(2, 4), 16) / 255
    const b = parseInt(hex.slice(4, 6), 16) / 255
    return (0.299 * r + 0.587 * g + 0.114 * b) < 0.5
}

/** 根据 tone 获取对应颜色值（neutral 走主题 token，其余按主题选档） */
export function getPermissionModeColor(token: GlobalToken, tone: string | null | undefined): string | undefined {
    if (!tone) return undefined
    const fixed = PERMISSION_TONE_FIXED[tone]
    if (fixed) return isDarkTheme(token) ? fixed.dark : fixed.light
    const key = PERMISSION_TONE_TOKEN[tone]
    if (!key) return undefined
    const value = token[key]
    return typeof value === 'string' ? value : undefined
}
