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

import { describe, it, expect } from 'vitest'
import { buildKeySequence } from '@/components/terminal/keySequence'

describe('buildKeySequence', () => {
    it('Ctrl + 字母 → 控制码（Ctrl+C = \\x03）', () => {
        expect(buildKeySequence(['ctrl'], 'c')).toEqual({ label: 'Ctrl+C', data: '\x03' })
        expect(buildKeySequence(['ctrl'], 'z')).toEqual({ label: 'Ctrl+Z', data: '\x1a' })
        expect(buildKeySequence(['ctrl'], 'a')).toEqual({ label: 'Ctrl+A', data: '\x01' })
    })

    it('Alt + 字母/数字 → \\x1b 前缀', () => {
        expect(buildKeySequence(['alt'], 'b')).toEqual({ label: 'Alt+B', data: '\x1bB' })
        expect(buildKeySequence(['alt'], '1')).toEqual({ label: 'Alt+1', data: '\x1b1' })
    })

    it('Ctrl+Alt 组合 → \\x1b 前缀控制码', () => {
        expect(buildKeySequence(['ctrl', 'alt'], 'c')).toEqual({ label: 'Ctrl+Alt+C', data: '\x1b\x03' })
    })

    it('Ctrl + 数字 不支持 → null', () => {
        expect(buildKeySequence(['ctrl'], '1')).toBeNull()
    })

    it('方向键（无修饰）→ CSI 序列', () => {
        expect(buildKeySequence([], 'arrowup')).toEqual({ label: '↑', data: '\x1b[A' })
        expect(buildKeySequence([], 'arrowdown')).toEqual({ label: '↓', data: '\x1b[B' })
        expect(buildKeySequence([], 'arrowright')).toEqual({ label: '→', data: '\x1b[C' })
        expect(buildKeySequence([], 'arrowleft')).toEqual({ label: '←', data: '\x1b[D' })
    })

    it('方向键 + 修饰 → 带 ;{code} 的 CSI 序列', () => {
        // shift=2 ctrl=5
        expect(buildKeySequence(['shift'], 'arrowup')!.data).toBe('\x1b[1;2A')
        expect(buildKeySequence(['ctrl'], 'arrowup')!.data).toBe('\x1b[1;5A')
    })

    it('Tab / Shift+Tab', () => {
        expect(buildKeySequence([], 'tab')).toEqual({ label: 'Tab', data: '\t' })
        expect(buildKeySequence(['shift'], 'tab')).toEqual({ label: 'Shift+Tab', data: '\x1b[Z' })
    })

    it('Ctrl/Alt + Tab 无通用序列 → null（不发编造码）', () => {
        expect(buildKeySequence(['ctrl'], 'tab')).toBeNull()
        expect(buildKeySequence(['alt'], 'tab')).toBeNull()
        expect(buildKeySequence(['ctrl', 'shift'], 'tab')).toBeNull()
    })

    it('Esc / Enter / Backspace / Space', () => {
        expect(buildKeySequence([], 'esc')).toEqual({ label: 'Esc', data: '\x1b' })
        expect(buildKeySequence([], 'enter')).toEqual({ label: '↵', data: '\r' })
        expect(buildKeySequence([], 'backspace')).toEqual({ label: '⌫', data: '\x7f' })
        expect(buildKeySequence([], 'space')).toEqual({ label: 'Space', data: ' ' })
    })

    it('导航键（Home/End/PgUp/PgDn/Ins/Del）', () => {
        expect(buildKeySequence([], 'home')!.data).toBe('\x1b[1~')
        expect(buildKeySequence([], 'end')!.data).toBe('\x1b[4~')
        expect(buildKeySequence([], 'pageup')!.data).toBe('\x1b[5~')
        expect(buildKeySequence(['ctrl'], 'delete')!.data).toBe('\x1b[3;5~')
    })

    it('功能键 F1-F12', () => {
        expect(buildKeySequence([], 'f1')).toEqual({ label: 'F1', data: '\x1bOP' })
        expect(buildKeySequence([], 'f5')).toEqual({ label: 'F5', data: '\x1b[15~' })
        expect(buildKeySequence([], 'f12')).toEqual({ label: 'F12', data: '\x1b[24~' })
        // F1-F4 + 修饰不支持
        expect(buildKeySequence(['shift'], 'f1')).toBeNull()
        // F5+ 修饰支持
        expect(buildKeySequence(['ctrl'], 'f5')!.data).toBe('\x1b[15;5~')
    })
})
