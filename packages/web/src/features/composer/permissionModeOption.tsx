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
 * 权限模式下拉框共享构建
 *
 * 两处复用：NewSessionPage（新建页 footer，收起态 图标+名称）、ChatComposer
 * （桌面端运行时切换，iconOnly 收起态仅图标）。选项统一由 buildPermissionModeHoverOptions
 * 组装——morph-select 壳的 description 槽承载描述行，tone 色随选项图标。
 */

import { createElement } from 'react'
import type { GlobalToken } from 'antd/es/theme/interface'
import type { PermissionMode, PermissionModeTone } from '@mobi/shared'
import { getPermissionModeOptionsForFlavor } from '@mobi/shared'
import { getPermissionModeColor } from './permissionModeColors'
import { getPermissionModeIcon } from './permissionModeIcons'
import type { CompactHoverSelectOption } from './CompactHoverSelect'

export interface PermissionModeSelectOption {
    value: string
    /** 仅名称，用于选中态紧凑显示 */
    label: string
    tone: PermissionModeTone
}

/**
 * 构建权限模式下拉选项（label 仅名称，附带 tone 供取色）
 *
 * 注意：dontAsk 在 UI 隐藏（仅过滤选项展示），功能完全保留——
 * PermissionMode 枚举 / SDK 协议 / daemon / cli 均不变；
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
 * 组装 CompactHoverSelect 选项：名称 + 描述双行（description 槽），tone 色随选项图标
 * （neutral 色调回落正文色，不染灰避免视觉弱化）。图标色写死在图标节点上——
 * 触发器选中态与列表项展示同一节点，tone 语义两处一致。
 */
export function buildPermissionModeHoverOptions(
    t: (key: string) => string,
    token: GlobalToken,
): CompactHoverSelectOption[] {
    return buildPermissionModeSelectOptions(t).map(option => ({
        value: option.value,
        label: option.label,
        description: t(`composer.permissionModeDescriptions.${option.value}`),
        icon: createElement(getPermissionModeIcon(option.value as PermissionMode), {
            style: { fontSize: 12, color: getPermissionModeColor(token, option.tone) ?? token.colorText },
        }),
    }))
}
