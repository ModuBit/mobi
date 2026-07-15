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
 * 权限模式下拉框共享渲染
 *
 * 三处复用：NewSessionForm（新建表单）、ChatComposer（桌面端运行时切换）、
 * NewSessionPage（移动端运行时切换）。
 *
 * 渲染策略：
 * - 选中态（label）：仅名称，紧凑显示
 * - 下拉项（optionRender）：名称（tone 色）+ 描述（secondary 小字），描述自动换行
 *   描述直接展示比悬停 tooltip 更直观；popupMatchSelectWidth=false 让宽度自适应
 */

import type { ReactNode } from 'react'
import type { GlobalToken } from 'antd/es/theme/interface'
import type { PermissionMode, PermissionModeTone } from '@mobi/shared'
import { getPermissionModeOptionsForFlavor, getPermissionModeTone } from '@mobi/shared'
import { getPermissionModeColor } from './permissionModeColors'
import { getPermissionModeIcon } from './permissionModeIcons'

export interface PermissionModeSelectOption {
    value: string
    /** 仅名称，用于选中态紧凑显示 */
    label: string
    tone: PermissionModeTone
}

/**
 * 权限模式下拉 popup 的 className（用于隐藏滚动条等样式作用域）
 */
export const PERMISSION_MODE_DROPDOWN_CLASS = 'permission-mode-dropdown'

let permStyleInjected = false
/**
 * 注入下拉样式：隐藏滚动条
 *
 * 双行 option（名称+描述）在 6 项内可完整展示，无需滚动条。
 * 兜底覆盖 rc-virtual-list 与 webkit/firefox 两种滚动条。
 */
export function usePermissionModeDropdownStyle(): void {
    if (!permStyleInjected && typeof document !== 'undefined') {
        const style = document.createElement('style')
        style.textContent = `
.${PERMISSION_MODE_DROPDOWN_CLASS} .rc-virtual-list-scrollbar { display: none !important; }
.${PERMISSION_MODE_DROPDOWN_CLASS} .rc-virtual-list-holder { overflow: hidden !important; scrollbar-width: none !important; }
.${PERMISSION_MODE_DROPDOWN_CLASS} .rc-virtual-list-holder::-webkit-scrollbar { display: none !important; }
`
        document.head.appendChild(style)
        permStyleInjected = true
    }
}

/**
 * 构建权限模式下拉选项（label 仅名称，附带 tone 供 optionRender 取用）
 *
 * 注意：dontAsk 在 UI 隐藏（仅过滤选项展示），功能完全保留——
 * PermissionMode 枚举 / SDK 协议 / hub / cli 均不变；
 * 已存在的 dontAsk 会话 resume 后仍按 dontAsk 模式正常运行。
 */
export function buildPermissionModeSelectOptions(t: (key: string) => string): PermissionModeSelectOption[] {
    return getPermissionModeOptionsForFlavor('claude')
        .filter(opt => opt.mode !== 'dontAsk')
        .map(opt => ({
            value: opt.mode,
            label: t(`composer.permissionModes.${opt.mode}`),
            tone: opt.tone,
        }))
}

/**
 * 渲染下拉项：名称（tone 色）+ 描述（secondary 12px）
 *
 * 用于 antd Select 的 optionRender。入参放宽为 unknown —— antd v6 的
 * optionRender 传入的是 FlattenOptionData 包装类型，但运行时即原始 option 对象，
 * 内部按需取 value/label/tone。neutral 色调回落到正文色（不染灰，避免视觉弱化）。
 */
export function renderPermissionModeOption(
    option: unknown,
    t: (key: string) => string,
    token: GlobalToken
): ReactNode {
    // antd optionRender 的 option 是 FlattenOptionData，原始数据在 option.data；
    // 兼容直接 option 与 .data 包装两种结构，确保 value/label 可靠取到
    const raw = (option ?? {}) as {
        value?: string; label?: string;
        data?: { value?: string; label?: string }
    }
    const source = raw.data ?? raw
    const mode = (source.value || raw.value || 'default') as PermissionMode
    const tone = getPermissionModeTone(mode)
    const label = source.label ?? raw.label ?? t(`composer.permissionModes.${mode}`)
    const color = getPermissionModeColor(token, tone)
    const Icon = getPermissionModeIcon(mode)
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '4px 0' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: color ?? token.colorText, fontWeight: 500 }}>
                <Icon style={{ fontSize: 13 }} />
                {label}
            </span>
            <span style={{ fontSize: 12, lineHeight: 1.35, color: token.colorTextSecondary, whiteSpace: 'normal' }}>
                {t(`composer.permissionModeDescriptions.${mode}`)}
            </span>
        </div>
    )
}
