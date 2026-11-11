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

import { describe, it, expect, vi } from 'vitest'
import {
    resolveComposerPanelKeyDown,
    type ComposerPanelKeyEvent,
    type ComposerPanelKeySource,
} from '@/features/composer/composerPanelKeys'
import type { PanelSelectionResult } from '@/features/composer/useChatInputBridge'

/** 面板桩：仅暴露仲裁 module 需要的成员 */
function panel(overrides: Partial<ComposerPanelKeySource> = {}): ComposerPanelKeySource {
    return {
        isOpen: false,
        items: [],
        handleKeyDown: vi.fn(() => false),
        selectCurrent: vi.fn(() => ({ text: 'selected', cursorPos: 8 })),
        ...overrides,
    }
}

function keyEvent(key: string): ComposerPanelKeyEvent & {
    preventDefault: ReturnType<typeof vi.fn>
    stopPropagation: ReturnType<typeof vi.fn>
} {
    return { key, preventDefault: vi.fn(), stopPropagation: vi.fn() }
}

/** 两面板都开且各有一条候选的基准场景 */
function openPair(slashResult: PanelSelectionResult = { text: '/cmd ', cursorPos: 5 }) {
    const slash = panel({ isOpen: true, items: [{}], selectCurrent: vi.fn(() => slashResult) })
    const mention = panel({ isOpen: true, items: [{}] })
    const applySelection = vi.fn()
    return { slash, mention, applySelection }
}

describe('resolveComposerPanelKeyDown', () => {
    it('Tab：slash 面板开着则选中当前项，阻断默认并转发选择结果', () => {
        const { slash, mention, applySelection } = openPair()
        const e = keyEvent('Tab')
        const consumed = resolveComposerPanelKeyDown(e, { text: '/cmd', slash, mention, applySelection })

        expect(consumed).toBe(true)
        expect(slash.selectCurrent).toHaveBeenCalledWith('/cmd')
        expect(applySelection).toHaveBeenCalledWith({ text: '/cmd ', cursorPos: 5 })
        expect(e.preventDefault).toHaveBeenCalled()
        expect(e.stopPropagation).toHaveBeenCalled()
        expect(mention.selectCurrent).not.toHaveBeenCalled()
    })

    it('Tab：slash 关时落到 mention 面板', () => {
        const slash = panel()
        const mention = panel({ isOpen: true, items: [{}], selectCurrent: vi.fn(() => ({ text: '@a.ts', cursorPos: 5 })) })
        const applySelection = vi.fn()
        const consumed = resolveComposerPanelKeyDown(keyEvent('Tab'), { text: '@a', slash, mention, applySelection })

        expect(consumed).toBe(true)
        expect(mention.selectCurrent).toHaveBeenCalledWith('@a')
        expect(applySelection).toHaveBeenCalledWith({ text: '@a.ts', cursorPos: 5 })
    })

    it('Tab：两面板都关则不消费，交给编辑器默认行为', () => {
        const slash = panel()
        const mention = panel()
        const applySelection = vi.fn()
        const e = keyEvent('Tab')
        const consumed = resolveComposerPanelKeyDown(e, { text: '', slash, mention, applySelection })

        expect(consumed).toBe(false)
        expect(applySelection).not.toHaveBeenCalled()
        expect(e.preventDefault).not.toHaveBeenCalled()
    })

    it('Enter：面板开着是选择不是发送（与 Tab 同路径）', () => {
        const { slash, mention, applySelection } = openPair()
        const e = keyEvent('Enter')
        const consumed = resolveComposerPanelKeyDown(e, { text: '/', slash, mention, applySelection })

        expect(consumed).toBe(true)
        expect(e.preventDefault).toHaveBeenCalled()
        expect(applySelection).toHaveBeenCalled()
    })

    it('面板开着但候选为空（items 0）时不消费', () => {
        const slash = panel({ isOpen: true, items: [] })
        const mention = panel({ isOpen: true, items: [] })
        const applySelection = vi.fn()
        const consumed = resolveComposerPanelKeyDown(keyEvent('Enter'), { text: '', slash, mention, applySelection })

        expect(consumed).toBe(false)
        expect(applySelection).not.toHaveBeenCalled()
    })

    it('Escape：委托面板消费，slash 优先级高于 mention', () => {
        const slash = panel({ isOpen: true, items: [{}], handleKeyDown: vi.fn(() => true) })
        const mention = panel({ isOpen: true, items: [{}], handleKeyDown: vi.fn(() => true) })
        const consumed = resolveComposerPanelKeyDown(keyEvent('Escape'), {
            text: '', slash, mention, applySelection: vi.fn(),
        })

        expect(consumed).toBe(true)
        expect(slash.handleKeyDown).toHaveBeenCalled()
        expect(mention.handleKeyDown).not.toHaveBeenCalled()
    })

    it('Escape：面板都未消费时返回 false，留给页面 abort 兜底', () => {
        const { slash, mention, applySelection } = openPair()
        const consumed = resolveComposerPanelKeyDown(keyEvent('Escape'), { text: '', slash, mention, applySelection })

        expect(consumed).toBe(false)
        expect(slash.handleKeyDown).toHaveBeenCalled()
        expect(mention.handleKeyDown).toHaveBeenCalled()
    })

    it('方向键：委托 slash.handleKeyDown 导航高亮', () => {
        const slash = panel({ isOpen: true, items: [{}], handleKeyDown: vi.fn(() => true) })
        const mention = panel({ isOpen: true, items: [{}], handleKeyDown: vi.fn(() => true) })
        const consumed = resolveComposerPanelKeyDown(keyEvent('ArrowDown'), {
            text: '', slash, mention, applySelection: vi.fn(),
        })

        expect(consumed).toBe(true)
        expect(slash.handleKeyDown).toHaveBeenCalled()
        expect(mention.handleKeyDown).not.toHaveBeenCalled()
    })

    it('其他键：不触碰面板，返回 false', () => {
        const { slash, mention, applySelection } = openPair()
        const consumed = resolveComposerPanelKeyDown(keyEvent('a'), { text: '', slash, mention, applySelection })

        expect(consumed).toBe(false)
        expect(slash.handleKeyDown).not.toHaveBeenCalled()
        expect(mention.handleKeyDown).not.toHaveBeenCalled()
        expect(applySelection).not.toHaveBeenCalled()
    })

    it('selectCurrent 返回 null 时原样转发（applySelection 内自带 no-op）', () => {
        const slash = panel({ isOpen: true, items: [{}], selectCurrent: vi.fn(() => null) })
        const mention = panel()
        const applySelection = vi.fn()
        resolveComposerPanelKeyDown(keyEvent('Enter'), { text: '/x', slash, mention, applySelection })

        expect(applySelection).toHaveBeenCalledWith(null)
    })
})
