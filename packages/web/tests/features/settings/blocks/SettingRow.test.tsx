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

import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { Settings as SettingsIcon } from 'lucide-react'

import { SettingRow } from '@/features/settings/blocks/SettingRow'
import { SettingGroupCard } from '@/features/settings/blocks/SettingGroupCard'

afterEach(() => cleanup())

describe('SettingRow value（只读值行）', () => {
    it('渲染 label 与右侧值，无交互角色', () => {
        render(<SettingRow label='外观' variant='value' value='系统' />)
        expect(screen.getByText('外观')).toBeTruthy()
        expect(screen.getByText('系统')).toBeTruthy()
        expect(screen.queryByRole('button')).toBeNull()
    })
})

describe('SettingRow inline-select（行内下拉）', () => {
    it('label + 当前选中项文案 + 下拉触发器', () => {
        render(
            <SettingRow
                label='外观'
                variant='inline-select'
                select={{
                    ariaLabel: '外观选择',
                    value: 'system',
                    options: [
                        { value: 'system', label: '系统' },
                        { value: 'light', label: '浅色' },
                    ],
                    onValueChange: vi.fn(),
                }}
            />,
        )
        expect(screen.getByText('外观')).toBeTruthy()
        // Radix Select 触发器以 combobox 角色暴露；触发器与隐藏 option 都含值文案，改断触发器内容
        const trigger = screen.getByRole('combobox', { name: '外观选择' })
        expect(trigger.textContent).toContain('系统')
    })
})

describe('SettingRow switch', () => {
    it('点击开关触发 onCheckedChange 新值', async () => {
        const onCheckedChange = vi.fn()
        render(<SettingRow label='遥测' variant='switch' checked={false} onCheckedChange={onCheckedChange} />)
        fireEvent.click(screen.getByRole('switch', { name: '遥测' }))
        // antd Switch 回调带第二参 event；契约只断首参 = 新值
        expect(onCheckedChange.mock.calls[0][0]).toBe(true)
    })

    it('aria-label 显式指定时不复用 label', () => {
        render(
            <SettingRow label='遥测' variant='switch' checked onCheckedChange={vi.fn()} ariaLabel='原始数据上报' />,
        )
        expect(screen.getByRole('switch', { name: '原始数据上报' })).toBeTruthy()
    })
})

describe('SettingRow input（行内输入）', () => {
    it('输入触发 onChange，label 作为可访问名', () => {
        const onChange = vi.fn()
        render(
            <SettingRow
                label='昵称'
                variant='input'
                input={{ placeholder: '输入昵称', value: '', onChange }}
            />,
        )
        fireEvent.change(screen.getByRole('textbox', { name: '昵称' }), { target: { value: '墨墨' } })
        expect(onChange).toHaveBeenCalled()
    })
})

describe('SettingRow navigate（导航行）', () => {
    it('整行是按钮，点击触发 onClick，右侧 chevron 装饰', () => {
        const onClick = vi.fn()
        render(<SettingRow label='参考照片' variant='navigate' onClick={onClick} />)
        fireEvent.click(screen.getByRole('button', { name: '参考照片' }))
        expect(onClick).toHaveBeenCalledOnce()
    })

    it('可带右侧当前值（值 + chevron 并存，ChatGPT 行形态）', () => {
        render(<SettingRow label='外观' variant='navigate' onClick={vi.fn()} value='系统' />)
        expect(screen.getByText('系统')).toBeTruthy()
    })
})

describe('SettingRow action（操作行）', () => {
    it('渲染右侧操作区并透传点击', async () => {
        const onSend = vi.fn()
        render(
            <SettingRow
                label='通知'
                variant='action'
                action={<button onClick={onSend}>发送测试通知</button>}
            />,
        )
        fireEvent.click(screen.getByRole('button', { name: '发送测试通知' }))
        expect(onSend).toHaveBeenCalledOnce()
    })
})

describe('SettingRow 通用件', () => {
    it('description 渲染为行下说明', () => {
        render(
            <SettingRow
                label='参考照片'
                variant='value'
                value='添加'
                description='这些照片可帮助创建更像你的图像'
            />,
        )
        expect(screen.getByText('这些照片可帮助创建更像你的图像')).toBeTruthy()
    })

    it('icon 可选渲染且不破坏可访问名', () => {
        render(<SettingRow label='记忆' variant='value' icon={SettingsIcon} value='关闭' />)
        expect(screen.getByText('记忆')).toBeTruthy()
    })
})

describe('SettingGroupCard（分组无缝卡）', () => {
    it('组标签渲染在卡外，行收进卡内', () => {
        render(
            <SettingGroupCard title='常规'>
                <SettingRow label='起始页面' variant='value' value='聊天' />
                <SettingRow label='外观' variant='value' value='系统' />
            </SettingGroupCard>,
        )
        expect(screen.getByText('常规')).toBeTruthy()
        expect(screen.getByText('起始页面')).toBeTruthy()
        expect(screen.getByText('外观')).toBeTruthy()
    })

    it('无组标签时不渲染空标签节点', () => {
        const { container } = render(
            <SettingGroupCard>
                <SettingRow label='外观' variant='value' value='系统' />
            </SettingGroupCard>,
        )
        expect(container.querySelector('h3, [data-group-title]')).toBeNull()
    })

    it('navigate 行在卡内保持按钮语义（fireEvent 冒烟）', () => {
        const onClick = vi.fn()
        render(
            <SettingGroupCard title='账户'>
                <SettingRow label='升级' variant='navigate' onClick={onClick} />
            </SettingGroupCard>,
        )
        fireEvent.click(screen.getByRole('button', { name: '升级' }))
        expect(onClick).toHaveBeenCalledOnce()
    })
})
