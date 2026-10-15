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
 * morph-select 本地修改的行为契约（registry.json localMods 对应）：direction 向上档、
 * description 双行槽（渲染 + 搜索匹配）、iconOnly 收起态、基础开合与选择。
 * jsdom 测不出的（真机验收项，见 .scratch/morph-select-migration/spec.md）：
 * 生长/飞行动效观感、双档主题显色、触屏 tap 直选。
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, cleanup, fireEvent, screen } from '@testing-library/react'
import { useState } from 'react'
import type { AnimationPlaybackControls, MotionValue } from 'motion/react'
import { MorphSelect, type MorphSelectItem } from '@/ui/shadcn/morph-select/morph-select'

/** jsdom 无 matchMedia：reduced 恒 false；animate 打桩成立即达（尺寸 spring 不必真跑） */
vi.mock('motion/react', async (importOriginal) => {
    const actual = await importOriginal<typeof import('motion/react')>()
    const animateStub = (value: MotionValue<number>, target: number): AnimationPlaybackControls => {
        value.set(target)
        const promise = new Promise<void>((resolve) => { setTimeout(resolve, 0) })
        return { stop() {}, then: (resolve, reject) => promise.then(resolve, reject) } as AnimationPlaybackControls
    }
    return { ...actual, animate: animateStub, useReducedMotion: () => false }
})

const ITEMS: MorphSelectItem[] = [
    { value: 'default', label: '默认', description: '跟随 CC 设置' },
    { value: 'explanatory', label: '讲解模式', description: '边写边讲' },
    { value: 'concise', label: '简洁模式' },
]

function Harness({ props }: { props?: Partial<Parameters<typeof MorphSelect>[0]> }) {
    const [value, setValue] = useState<string | null>('default')
    return <MorphSelect
        label="输出风格"
        items={ITEMS}
        value={value}
        onValueChange={(v) => setValue(v)}
        {...props}
    />
}

describe('morph-select 基础开合', () => {
    afterEach(cleanup)

    it('收起态渲染选中项 label，点击展开列表', () => {
        render(<Harness />)
        expect(screen.getByRole('combobox')).toHaveTextContent('默认')
        fireEvent.click(screen.getByRole('combobox'))
        expect(screen.getByRole('listbox')).toBeInTheDocument()
        expect(screen.getByRole('option', { name: /简洁模式/ })).toBeInTheDocument()
    })

    it('点击选项回调 onValueChange 并收起', () => {
        const onValueChange = vi.fn()
        render(<MorphSelect label="输出风格" items={ITEMS} value="default" onValueChange={onValueChange} />)
        fireEvent.click(screen.getByRole('combobox'))
        fireEvent.click(screen.getByRole('option', { name: /讲解模式/ }))
        expect(onValueChange).toHaveBeenCalledWith('explanatory', expect.objectContaining({ value: 'explanatory' }))
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    })

    it('Escape 关闭且不改变选中', () => {
        const onValueChange = vi.fn()
        render(<MorphSelect label="输出风格" items={ITEMS} value="default" onValueChange={onValueChange} />)
        fireEvent.click(screen.getByRole('combobox'))
        fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' })
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
        expect(onValueChange).not.toHaveBeenCalled()
    })
})

describe('direction 向上档（mobi 本地槽位）', () => {
    afterEach(cleanup)

    it('默认 down，显式 up 时 root 带 data-direction="up"', () => {
        const { container, rerender } = render(<Harness />)
        expect(container.firstElementChild).toHaveAttribute('data-direction', 'down')
        rerender(<Harness props={{ direction: 'up' }} />)
        expect(container.firstElementChild).toHaveAttribute('data-direction', 'up')
    })

    it('up 档展开后列表仍在文档流内且行为不变（点击可选）', () => {
        const onValueChange = vi.fn()
        render(<MorphSelect label="输出风格" items={ITEMS} value="default" onValueChange={onValueChange} direction="up" />)
        fireEvent.click(screen.getByRole('combobox'))
        fireEvent.click(screen.getByRole('option', { name: /简洁模式/ }))
        expect(onValueChange).toHaveBeenCalledWith('concise', expect.objectContaining({ value: 'concise' }))
    })
})

describe('description 双行槽（mobi 本地槽位）', () => {
    afterEach(cleanup)

    it('展开后渲染描述行', () => {
        render(<Harness />)
        fireEvent.click(screen.getByRole('combobox'))
        expect(screen.getByRole('option', { name: /默认/ })).toHaveTextContent('跟随 CC 设置')
        // 无 description 的项不渲染描述
        expect(screen.getByRole('option', { name: /简洁模式/ })).not.toHaveTextContent('跟随')
    })

    it('搜索按 description 匹配', () => {
        render(<Harness props={{ searchable: true }} />)
        // searchable 时 trigger(button) 与搜索框(input) 都是 role=combobox，按标签名区分
        const roleBy = (tag: string) => screen.getAllByRole('combobox').find(el => el.tagName === tag)!
        fireEvent.click(roleBy('BUTTON'))
        fireEvent.change(roleBy('INPUT'), { target: { value: '边写边讲' } })
        expect(screen.getByRole('option', { name: /讲解模式/ })).toBeInTheDocument()
        expect(screen.queryByRole('option', { name: /默认/ })).not.toBeInTheDocument()
    })
})

describe('iconOnly 收起态（mobi 本地槽位）', () => {
    afterEach(cleanup)

    it('lid 不渲染 label 文本，label 转 srOnly，列表项仍完整', () => {
        render(<Harness props={{ iconOnly: true }} />)
        const trigger = screen.getByRole('combobox')
        expect(trigger).not.toHaveTextContent('默认')
        fireEvent.click(trigger)
        // 列表恒完整渲染 label + description
        expect(screen.getByRole('option', { name: /默认/ })).toHaveTextContent('跟随 CC 设置')
    })
})
