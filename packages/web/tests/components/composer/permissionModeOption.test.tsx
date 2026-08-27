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
 * 权限模式下拉共享渲染规格。
 * 回归背景：composer 运行时切换器的收起态把 label 征用为「图标节点」（只展示
 * 图标），此时 optionRender 必须仍从 i18n 取名称，不得回落到 label。
 */

import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { buildPermissionModeSelectOptions, renderPermissionModeOption } from '@/components/composer/permissionModeOption'

const t = (key: string) => {
    const dict: Record<string, string> = {
        'composer.permissionModes.auto': '自动审批',
        'composer.permissionModes.default': '请求批准',
        'composer.permissionModes.acceptEdits': '接受编辑',
        'composer.permissionModes.plan': '计划模式',
        'composer.permissionModes.dontAsk': '静默拒绝',
        'composer.permissionModes.bypassPermissions': 'YOLO',
        'composer.permissionModeDescriptions.acceptEdits': '自动接受文件编辑与文件操作',
        'composer.permissionModeDescriptions.bypassPermissions': '跳过所有检查立即执行（谨慎）',
    }
    return dict[key] ?? key
}

afterEach(cleanup)

describe('buildPermissionModeSelectOptions', () => {
    it('隐藏 dontAsk；label 为 i18n 名称，附带 tone', () => {
        const opts = buildPermissionModeSelectOptions(t)
        expect(opts.map(o => o.value)).not.toContain('dontAsk')
        expect(opts.every(o => typeof o.label === 'string' && !o.label.startsWith('composer.'))).toBe(true)
        expect(opts.every(o => typeof o.tone === 'string')).toBe(true)
    })
})

describe('renderPermissionModeOption', () => {
    it('label 被征用为图标节点时，名称仍按 mode 从 i18n 取', () => {
        // 模拟 ChatComposer 收起态改造后的 options：label 已替换为 ReactNode
        const option = { value: 'acceptEdits', label: <span data-testid="icon-placeholder" />, tone: 'success' }
        const { container, getByText } = render(
            <div>{renderPermissionModeOption(option, t, {} as never)}</div>,
        )
        expect(getByText('接受编辑')).toBeTruthy()   // 名称来自 i18n，而非被征用的 label
        expect(getByText('自动接受文件编辑与文件操作')).toBeTruthy()
        expect(container.querySelector('svg')).toBeTruthy()   // 模式自带图标正常渲染
    })

    it('兼容 FlattenOptionData 包装结构（option.data 携带原始对象）', () => {
        const option = { data: { value: 'bypassPermissions', label: 'YOLO' } }
        const { getByText } = render(<div>{renderPermissionModeOption(option, t, {} as never)}</div>)
        expect(getByText('YOLO')).toBeTruthy()
        expect(getByText('跳过所有检查立即执行（谨慎）')).toBeTruthy()
    })
})
