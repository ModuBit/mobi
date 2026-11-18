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
 * slash 命令面板选中的原子替换区间（useSlashCommandInteraction.selectItem）：
 * - from 含前导普通空格（节点 attrs 还原，CC 的边界识别依赖这个分隔空白）
 * - to 吸收命令词之后的同行空格/制表符（节点自带尾随空格，不吸收会叠加成双空格）
 * - 不吸收制表符作前导（renderText 只还原普通空格，吸收会改写字面量）
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'

const slashState = vi.hoisted(() => ({
    items: [] as Array<{ label: string; value: string }>,
    isLoading: false,
}))
vi.mock('@/features/composer/useSlashCommandSuggestion', () => ({
    useSlashCommandSuggestion: () => slashState,
}))

import { useSlashCommandInteraction } from '@/features/composer/useSlashCommandInteraction'

afterEach(cleanup)

const handItem = { label: '/hand', value: '/hand' }

function setup() {
    return renderHook(() => useSlashCommandInteraction({
        commandsData: [],
        commandsLoading: false,
        workingDir: undefined,
    }))
}

describe('selectItem 的原子替换区间', () => {
    it('行首命令：from = 0，to 覆盖命令词', () => {
        const { result } = setup()
        act(() => { result.current.processChange('/hand', 5) })
        let selected: ReturnType<typeof result.current.selectItem> = null
        act(() => { selected = result.current.selectItem(handItem, '/hand') })
        expect(selected!.slashCommand).toEqual({ command: 'hand', from: 0, to: 5, leadingSpace: false })
        expect(selected!.cursorPos).toBe(6)
    })

    it('前空格命令：from 吸收该空格（CC 的「前空格 + 后空格」边界）', () => {
        const { result } = setup()
        act(() => { result.current.processChange('foo /hand', 9) })
        let selected: ReturnType<typeof result.current.selectItem> = null
        act(() => { selected = result.current.selectItem(handItem, 'foo /hand') })
        expect(selected!.slashCommand).toEqual({ command: 'hand', from: 3, to: 9, leadingSpace: true })
    })

    it('命令后的同行空白一并吸收（不叠加成双空格）', () => {
        const { result } = setup()
        act(() => { result.current.processChange('/hand  arg', 5) })
        let selected: ReturnType<typeof result.current.selectItem> = null
        act(() => { selected = result.current.selectItem(handItem, '/hand  arg') })
        // to 越过命令词后的两个空格；结果文本与旧文本替换语义一致（单个分隔空格）
        expect(selected!.slashCommand).toEqual({ command: 'hand', from: 0, to: 7, leadingSpace: false })
        expect(selected!.text).toBe('/hand arg')
    })

    it('前导制表符不吸收（节点只还原普通空格，吸收会改写字面量）', () => {
        const { result } = setup()
        act(() => { result.current.processChange('foo\t/hand', 9) })
        let selected: ReturnType<typeof result.current.selectItem> = null
        act(() => { selected = result.current.selectItem(handItem, 'foo\t/hand') })
        expect(selected!.slashCommand).toEqual({ command: 'hand', from: 4, to: 9, leadingSpace: false })
    })
})
