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
import { fireEvent, render, screen, cleanup } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ExpandingSearch } from '@/ui/base/interactive/expanding-search/ExpandingSearch'

afterEach(cleanup)

/** 过滤模式（头注①）：不传 items 只借 morph 形态——受控 value/onValueChange，无结果面板 */
describe('ExpandingSearch 过滤模式', () => {
  /** 受控组件：键入要真实回写 value（固定 value 会mock 出「键入不生效」的假象） */
  function FilterHarness({ onValueChange }: { onValueChange: (v: string) => void }) {
    const [value, setValue] = useState('')
    return <ExpandingSearch label="搜索技能" value={value} onValueChange={v => { onValueChange(v); setValue(v) }} />
  }

  const setup = () => {
    const onValueChange = vi.fn()
    const { container } = render(<FilterHarness onValueChange={onValueChange} />)
    return { onValueChange, container }
  }

  /** 展开的 input 才接受输入（收起态 inert，test 里的点击目标恒是 trigger 按钮） */
  function expand(container: HTMLElement) {
    const trigger = container.querySelector('button[type="button"]') as HTMLButtonElement
    expect(trigger).toBeTruthy()
    fireEvent.click(trigger)
    return container.querySelector('input') as HTMLInputElement
  }

  it('收起态：icon trigger 可见、输入框 inert、无结果面板', () => {
    const { container } = setup()
    const trigger = container.querySelector('button[type="button"]') as HTMLButtonElement
    expect(trigger.hidden).toBe(false)
    const input = container.querySelector('input') as HTMLInputElement
    expect(input.hasAttribute('inert')).toBe(true)
    expect(container.querySelector('[role="listbox"]')).toBeNull()
  })

  it('展开后键入实时喂 onValueChange（受控契约与 SearchField 一致）', () => {
    const { container, onValueChange } = setup()
    const input = expand(container)
    fireEvent.change(input, { target: { value: 'research' } })
    expect(onValueChange).toHaveBeenCalledWith('research')
  })

  it('有词失焦不折叠（列表持续过滤可见）；清空后失焦折回', () => {
    const { container } = setup()
    const input = expand(container)
    fireEvent.change(input, { target: { value: 'res' } })
    fireEvent.blur(input)
    // 有词：保持展开（inert 不回来）
    expect(input.hasAttribute('inert')).toBe(false)

    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input)
    // 空值：折回成 icon
    expect((container.querySelector('input') as HTMLInputElement).hasAttribute('inert')).toBe(true)
  })

  it('Escape 折叠并清空关键词（不留看不见的过滤词）', () => {
    const { container, onValueChange } = setup()
    const input = expand(container)
    fireEvent.change(input, { target: { value: 'res' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onValueChange).toHaveBeenCalledWith('')
    expect((container.querySelector('input') as HTMLInputElement).hasAttribute('inert')).toBe(true)
  })

  it('过滤模式不渲染结果面板（无 listbox / 空态）', () => {
    const { container } = setup()
    const input = expand(container)
    fireEvent.change(input, { target: { value: 'res' } })
    expect(container.querySelector('[role="listbox"]')).toBeNull()
    expect(container.querySelector('[role="option"]')).toBeNull()
  })

  it('导航模式（传 items）仍走本地结果面板', () => {
    const onSelect = vi.fn()
    const { container } = render(
      <ExpandingSearch
        label="搜索"
        items={[
          { id: 'a', title: 'research' },
          { id: 'b', title: 'domain-modeling' },
        ]}
        onSelect={onSelect}
      />,
    )
    const input = expand(container)
    fireEvent.change(input, { target: { value: 'research' } })
    const option = screen.getByRole('option', { name: /research/ })
    fireEvent.click(option)
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }))
  })
})
