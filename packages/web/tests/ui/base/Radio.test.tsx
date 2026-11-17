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
 * 单 Radio 契约：原生 input 承载语义（role/aria-checked/disabled），label 整行可点；
 * 受控只上报、uncontrolled 自持状态；点选回调给变化后的布尔值。
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { Radio } from '@/ui/base/interactive/radio/Radio'

afterEach(cleanup)

describe('Radio', () => {
    it('受控：点击整行只上报 onChange(true)，选中态由 checked 决定', () => {
        const onChange = vi.fn()
        const { rerender } = render(<Radio checked={false} onChange={onChange}>主目录</Radio>)
        const input = screen.getByRole('radio', { name: '主目录' })
        expect(input).not.toBeChecked()

        fireEvent.click(screen.getByText('主目录'))
        expect(onChange).toHaveBeenCalledWith(true)
        expect(input).not.toBeChecked()

        rerender(<Radio checked onChange={onChange}>主目录</Radio>)
        expect(input).toBeChecked()
    })

    it('uncontrolled：defaultChecked 起步，点选后自持选中态', () => {
        const onChange = vi.fn()
        render(<Radio defaultChecked={false} onChange={onChange}>主目录</Radio>)
        const input = screen.getByRole('radio', { name: '主目录' })
        fireEvent.click(input)
        expect(onChange).toHaveBeenCalledWith(true)
        expect(input).toBeChecked()
    })

    it('disabled：原生 input 禁用，点击不上报', () => {
        const onChange = vi.fn()
        render(<Radio checked={false} disabled onChange={onChange}>主目录</Radio>)
        const input = screen.getByRole('radio', { name: '主目录' })
        expect(input).toBeDisabled()
        fireEvent.click(screen.getByText('主目录'))
        expect(onChange).not.toHaveBeenCalled()
    })

    it('name/value 透传到原生 input（需要浏览器成组互斥时）', () => {
        render(
            <div>
                <Radio name="primary" value="a" defaultChecked>A</Radio>
                <Radio name="primary" value="b">B</Radio>
            </div>
        )
        const [a, b] = screen.getAllByRole('radio') as HTMLInputElement[]
        expect(a!.name).toBe('primary')
        expect(b!.value).toBe('b')
    })

    it('点击已选中项不触发 change（原生 radio 语义，与 antd 一致）', () => {
        const onChange = vi.fn()
        render(<Radio checked onChange={onChange}>主目录</Radio>)
        fireEvent.click(screen.getByRole('radio', { name: '主目录' }))
        expect(onChange).not.toHaveBeenCalled()
    })
})

// 受控用法的一个真实形态：外部 state 驱动（WorkspaceFormModal 的文件夹行）
function ControlledHarness() {
    const [on, setOn] = useState(false)
    return <Radio checked={on} onChange={setOn}>主目录</Radio>
}

describe('Radio 受控回环', () => {
    it('onChange 回写外部 state 后指示器跟随', () => {
        render(<ControlledHarness />)
        const input = screen.getByRole('radio', { name: '主目录' })
        fireEvent.click(input)
        expect(input).toBeChecked()
    })
})
