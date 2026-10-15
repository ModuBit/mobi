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
 * output style 下拉选项构建与装配规格。
 *
 * - 内置五选项按 CC /config 官方菜单序，label 为英文名（CC 原名，不翻译）
 * - 内置项渲染「名称 + i18n 描述」双行；自定义 style（init 上报的非内置名）
 *   只渲染原名、无描述行（SDK 不透传 frontmatter）
 * - descriptionOverrideKey 优先于 Descriptions 命名空间（「跟随 CC 设置」项）
 *
 * 渲染路径经 OutputStyleSelect（CompactHoverSelect 壳 → morph-select）断言：
 * antd optionRender 已退役，不再测 .data 解包（morph 壳直接消费结构化选项）。
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import type { AnimationPlaybackControls, MotionValue } from 'motion/react'
import { buildOutputStyleSelectOptions, OutputStyleSelect } from '@/features/composer/outputStyleOption'

// jsdom 无 matchMedia：morph 动效打桩成立即达（尺寸 spring 不必真跑）
vi.mock('motion/react', async (importOriginal) => {
    const actual = await importOriginal<typeof import('motion/react')>()
    const animateStub = (value: MotionValue<number>, target: number): AnimationPlaybackControls => {
        value.set(target)
        const promise = new Promise<void>((resolve) => { setTimeout(resolve, 0) })
        return { stop() {}, then: (resolve, reject) => promise.then(resolve, reject) } as AnimationPlaybackControls
    }
    return { ...actual, animate: animateStub, useReducedMotion: () => false }
})

afterEach(cleanup)

describe('buildOutputStyleSelectOptions', () => {
    it('内置五选项，官方菜单序，值为 CC 规范形（default 小写 + 四驼峰）', () => {
        const options = buildOutputStyleSelectOptions()
        expect(options.map((o) => o.value)).toEqual(['default', 'Proactive', 'Concise', 'Explanatory', 'Learning'])
        expect(options[0].label).toBe('Default')
    })
})

describe('OutputStyleSelect 装配', () => {
    const t = (key: string) => key

    function Harness(props: Partial<Parameters<typeof OutputStyleSelect>[0]> = {}) {
        return (
            <OutputStyleSelect
                value="default"
                options={[
                    { value: '', label: '跟随 CC 设置', descriptionOverrideKey: 'composer.outputStyleFollowSettingDesc' },
                    ...buildOutputStyleSelectOptions(),
                ]}
                onChange={() => {}}
                {...props}
            />
        )
    }

    const trigger = () => screen.getAllByRole('combobox').find(el => el.tagName === 'BUTTON')!

    it('内置项渲染名称 + i18n 描述双行（descriptionKey = 规范形 style 值）', async () => {
        render(<Harness />)
        fireEvent.click(trigger())
        const proactive = await screen.findByRole('option', { name: /Proactive/ })
        expect(proactive).toHaveTextContent('composer.outputStyleDescriptions.Proactive')
    })

    it('descriptionOverrideKey 优先于 Descriptions 命名空间（「跟随 CC 设置」项）', async () => {
        render(<Harness value="" />)
        fireEvent.click(trigger())
        const follow = await screen.findByRole('option', { name: /跟随 CC 设置/ })
        expect(follow).toHaveTextContent('composer.outputStyleFollowSettingDesc')
        expect(follow.textContent).not.toContain('Descriptions.')
    })

    it('非内置名（init 上报的自定义 style）渲染原名、无描述行', async () => {
        render(<Harness options={[...buildOutputStyleSelectOptions(), { value: 'my-style', label: 'my-style' }]} />)
        fireEvent.click(trigger())
        const custom = await screen.findByRole('option', { name: /my-style/ })
        expect(custom.textContent).not.toContain('Descriptions')
    })
})
