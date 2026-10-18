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
 * 建议列表异步收缩的回归：activeIndex 必须夹取到新结果范围内，
 * 否则 Enter/Tab 取到 items[越界] === undefined，selectItem 里读属性抛 TypeError。
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import type { KeyboardEvent } from 'react'

const listingState = vi.hoisted(() => ({
    items: [] as Array<{ label: string; value: string; isDirectory: boolean }>,
    isLoading: false,
}))
vi.mock('@/features/composer/useFileListing', () => ({
    useFileListing: () => listingState,
}))

const slashState = vi.hoisted(() => ({
    items: [] as Array<{ label: string; value: string }>,
    isLoading: false,
}))
vi.mock('@/features/composer/useSlashCommandSuggestion', () => ({
    useSlashCommandSuggestion: () => slashState,
}))

import { useMentionInteraction } from '@/features/composer/useMentionInteraction'
import { useSlashCommandInteraction } from '@/features/composer/useSlashCommandInteraction'

afterEach(cleanup)

const arrowDown = { key: 'ArrowDown', preventDefault: () => {} } as KeyboardEvent

describe('建议列表收缩后的 activeIndex 夹取', () => {
    it('mention：结果从 9 条收缩到 3 条后下标夹到 2，Enter 取到有效项', () => {
        listingState.items = Array.from({ length: 9 }, (_, i) => ({ label: `f${i}`, value: `f${i}`, isDirectory: false }))
        const { result, rerender } = renderHook(() => useMentionInteraction({
            target: null,
            searchFiles: null,
            listDirectory: null,
            workingDir: '/w',
        }))

        act(() => { result.current.processChange('@', 1) })
        expect(result.current.isOpen).toBe(true)
        act(() => {
            for (let i = 0; i < 8; i++) result.current.handleKeyDown(arrowDown)
        })
        expect(result.current.activeIndex).toBe(8)

        listingState.items = listingState.items.slice(0, 3)
        rerender()

        expect(result.current.activeIndex).toBe(2)
        let selected: unknown
        act(() => { selected = result.current.selectCurrent('@') })
        expect(selected).not.toBeNull()
    })

    it('slash：命令集收缩后下标夹取，Enter 取到有效项', () => {
        slashState.items = Array.from({ length: 9 }, (_, i) => ({ label: `/c${i}`, value: `/c${i}` }))
        const { result, rerender } = renderHook(() => useSlashCommandInteraction({
            commandsData: [],
            commandsLoading: false,
            workingDir: '/w',
        }))

        act(() => { result.current.processChange('/a', 2) })
        expect(result.current.isOpen).toBe(true)
        act(() => {
            for (let i = 0; i < 8; i++) result.current.handleKeyDown(arrowDown)
        })
        expect(result.current.activeIndex).toBe(8)

        slashState.items = slashState.items.slice(0, 3)
        rerender()

        expect(result.current.activeIndex).toBe(2)
        let selected: unknown
        act(() => { selected = result.current.selectCurrent('/a') })
        expect(selected).not.toBeNull()
    })
})
