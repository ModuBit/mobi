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
 * output style 下拉选项构建与渲染规格。
 *
 * - 内置五选项按 CC /config 官方菜单序，label 为英文名（CC 原名，不翻译）
 * - 内置项渲染「名称 + i18n 描述」双行；自定义 style（init 上报的非内置名）
 *   只渲染原名、无描述行（SDK 不透传 frontmatter）
 * - 兼容 antd optionRender 的 FlattenOptionData 包装结构（原始对象在 .data）
 */

import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { buildOutputStyleSelectOptions, renderOutputStyleOption } from '@/components/composer/outputStyleOption'

afterEach(cleanup)

describe('buildOutputStyleSelectOptions', () => {
    it('内置五选项，官方菜单序，值为 CC 规范形（default 小写 + 四驼峰）', () => {
        const options = buildOutputStyleSelectOptions()
        expect(options.map((o) => o.value)).toEqual(['default', 'Proactive', 'Concise', 'Explanatory', 'Learning'])
        expect(options[0].label).toBe('Default')
    })
})

describe('renderOutputStyleOption', () => {
    it('内置项渲染名称 + i18n 描述双行（descriptionKey = 规范形 style 值）', () => {
        const options = buildOutputStyleSelectOptions()
        render(<div>{renderOutputStyleOption({ value: 'Proactive' }, options, (k) => k)}</div>)
        expect(screen.getByText('Proactive')).toBeInTheDocument()
        expect(screen.getByText('composer.outputStyleDescriptions.Proactive')).toBeInTheDocument()
    })

    it('descriptionOverrideKey 优先于 Descriptions 命名空间（「跟随 CC 设置」项）', () => {
        const options = [
            { value: '', label: '跟随 CC 设置', descriptionOverrideKey: 'composer.outputStyleFollowSettingDesc' },
            ...buildOutputStyleSelectOptions(),
        ]
        render(<div>{renderOutputStyleOption({ value: '' }, options, (k) => k)}</div>)
        expect(screen.getByText('跟随 CC 设置')).toBeInTheDocument()
        expect(screen.getByText('composer.outputStyleFollowSettingDesc')).toBeInTheDocument()
    })

    it('非内置名（init 上报的自定义 style）渲染原名、无描述行', () => {
        const options = buildOutputStyleSelectOptions()
        render(<div>{renderOutputStyleOption({ value: 'my-style' }, options, (k) => k)}</div>)
        expect(screen.getByText('my-style')).toBeInTheDocument()
        expect(screen.queryByText(/Descriptions/)).toBeNull()
    })

    it('antd optionRender 的 .data 包装结构正确解包', () => {
        const options = buildOutputStyleSelectOptions()
        render(<div>{renderOutputStyleOption({ data: { value: 'Learning' } }, options, (k) => k)}</div>)
        expect(screen.getByText('Learning')).toBeInTheDocument()
    })
})
