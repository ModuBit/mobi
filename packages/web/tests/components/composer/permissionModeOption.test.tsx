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
 * 权限模式下拉共享构建规格。
 * 迁移 morph-select 后选项形态 = 名称 + 描述双行（description 槽）+ tone 色图标；
 * renderPermissionModeOption 已随 antd optionRender 退役，改为断言
 * buildPermissionModeHoverOptions 的组装契约（morph 壳直接消费）。
 */

import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { buildPermissionModeSelectOptions, buildPermissionModeHoverOptions } from '@/features/composer/permissionModeOption'
import type { GlobalToken } from 'antd/es/theme/interface'

const t = (key: string) => {
    const dict: Record<string, string> = {
        'composer.permissionModes.auto': '自动审批',
        'composer.permissionModes.default': '请求批准',
        'composer.permissionModes.acceptEdits': '接受编辑',
        'composer.permissionModes.plan': '计划模式',
        'composer.permissionModes.bypassPermissions': 'YOLO',
        'composer.permissionModeDescriptions.acceptEdits': '自动接受文件编辑与文件操作',
        'composer.permissionModeDescriptions.bypassPermissions': '跳过所有检查立即执行（谨慎）',
    }
    return dict[key] ?? key
}

const token = {
    colorText: '#000000',
    getPermissionModeColor: undefined,
} as unknown as GlobalToken

describe('buildPermissionModeSelectOptions', () => {
    it('隐藏 dontAsk；label 为 i18n 名称，附带 tone', () => {
        const opts = buildPermissionModeSelectOptions(t)
        expect(opts.map(o => o.value)).not.toContain('dontAsk')
        expect(opts.every(o => typeof o.label === 'string' && !o.label.startsWith('composer.'))).toBe(true)
        expect(opts.every(o => typeof o.tone === 'string')).toBe(true)
    })
})

describe('buildPermissionModeHoverOptions', () => {
    it('名称 + 描述双行齐全，dontAsk 仍隐藏', () => {
        const opts = buildPermissionModeHoverOptions(t, token)
        expect(opts.map(o => o.value)).not.toContain('dontAsk')
        const acceptEdits = opts.find(o => o.value === 'acceptEdits')!
        expect(acceptEdits.label).toBe('接受编辑')
        expect(acceptEdits.description).toBe('自动接受文件编辑与文件操作')
        const yolo = opts.find(o => o.value === 'bypassPermissions')!
        expect(yolo.description).toBe('跳过所有检查立即执行（谨慎）')
    })

    it('图标节点带 tone 色（写死在图标上，触发器选中态与列表项同色）', () => {
        const opts = buildPermissionModeHoverOptions(t, token)
        for (const opt of opts) {
            expect(createElement('div', {}, opt.icon)).toBeTruthy()
            // 图标是 React 元素（svg 组件），props.style 携带显式颜色
            const icon = opt.icon as { props?: { style?: { color?: string } } } | undefined
            expect(typeof icon?.props?.style?.color).toBe('string')
        }
    })
})
