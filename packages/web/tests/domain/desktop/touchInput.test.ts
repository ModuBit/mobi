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

import { describe, expect, it, vi } from 'vitest'
import {
    KEYSYM,
    SENTINEL_VALUE,
    TOOLBAR_KEYS,
    TOUCH_MODIFIERS,
    TouchModifierState,
    diffSentinelValue,
    sendBackspaces,
    sendText,
    tapKey,
} from '@/domain/desktop/touchInput'

describe('diffSentinelValue（哨兵值 diff）', () => {
    it('无变化 → 零动作', () => {
        expect(diffSentinelValue(SENTINEL_VALUE, SENTINEL_VALUE)).toEqual({ backspaces: 0, inserted: '' })
    })

    it('尾部插入 → 纯插入文本', () => {
        const result = diffSentinelValue('____abc', '____abcd')
        expect(result).toEqual({ backspaces: 0, inserted: 'd' })
    })

    it('尾部删除 → 按码点计删除数（UTF-16 增补字符一次删除动作）', () => {
        // '😀' 是 UTF-16 代理对（length 2）但一次删除
        expect(diffSentinelValue('____ab😀', '____ab')).toEqual({ backspaces: 1, inserted: '' })
        expect(diffSentinelValue('____ab', '____a')).toEqual({ backspaces: 1, inserted: '' })
    })

    it('中间编辑：删除 + 插入同时报告', () => {
        expect(diffSentinelValue('____hello', '____help!')).toEqual({ backspaces: 2, inserted: 'p!' })
    })

    it('清空到空串：哨兵语义下全部删除', () => {
        expect(diffSentinelValue('____ab', '')).toEqual({ backspaces: 6, inserted: '' })
    })

    it('回车插入按字面字符报告（sendText 侧归一为 Enter）', () => {
        expect(diffSentinelValue('____a', '____a\n')).toEqual({ backspaces: 0, inserted: '\n' })
    })
})

describe('TouchModifierState（点按修饰键状态机）', () => {
    it('toggle 切换挂起态', () => {
        const mods = new TouchModifierState()
        expect(mods.toggle('ShiftLeft')).toBe(true)
        expect(mods.isActive('ShiftLeft')).toBe(true)
        expect(mods.toggle('ShiftLeft')).toBe(false)
        expect(mods.isActive('ShiftLeft')).toBe(false)
    })

    it('多修饰键可同时挂起，consume 返回 keysym 并清空', () => {
        const mods = new TouchModifierState()
        mods.toggle('ControlLeft')
        mods.toggle('ShiftLeft')
        // consume 按 TOUCH_MODIFIERS 声明序返回（按下顺序确定性，与点按顺序无关）
        expect(mods.consume()).toEqual([KEYSYM.SHIFT, KEYSYM.CONTROL])
        expect(mods.consume()).toEqual([])
    })

    it('consume 后重新挂起从零开始', () => {
        const mods = new TouchModifierState()
        mods.toggle('AltLeft')
        mods.consume()
        expect(mods.isActive('AltLeft')).toBe(false)
        mods.toggle('MetaLeft')
        expect(mods.consume()).toEqual([KEYSYM.META])
    })

    it('clear 不返回 keysym（控制权丢失即静默丢弃）', () => {
        const mods = new TouchModifierState()
        mods.toggle('ShiftLeft')
        mods.clear()
        expect(mods.consume()).toEqual([])
    })

    it('TOUCH_MODIFIERS 覆盖四键且 keysym 唯一', () => {
        expect(TOUCH_MODIFIERS.map((m) => m.code)).toEqual(['ShiftLeft', 'ControlLeft', 'AltLeft', 'MetaLeft'])
        expect(new Set(TOUCH_MODIFIERS.map((m) => m.keysym)).size).toBe(4)
    })
})

describe('TOOLBAR_KEYS', () => {
    it('覆盖常用键且 keysym 正确', () => {
        const byCode = new Map(TOOLBAR_KEYS.map((k) => [k.code, k.keysym]))
        expect(byCode.get('Escape')).toBe(0xff1b)
        expect(byCode.get('Tab')).toBe(0xff09)
        expect(byCode.get('Enter')).toBe(0xff0d)
        expect(byCode.get('ArrowUp')).toBe(0xff52)
        expect(byCode.get('Backspace')).toBe(0xff08)
    })
})

/** 记录 sendKey/sendText 调用序列的假键盘（远端注入顺序在这里断言） */
function fakeKeyboard() {
    const calls: string[] = []
    return {
        calls,
        connection: {
            sendKey(keysym: number, down?: boolean) {
                calls.push(`${down === false ? 'up' : 'down'}:${keysym.toString(16)}`)
            },
            sendText(text: string) {
                calls.push(`text:${text}`)
            },
        },
    }
}

describe('输入组合器（修饰键括号）', () => {
    it('tapKey：mods 按下 → 敲键 → mods 反序释放', () => {
        const { connection, calls } = fakeKeyboard()
        tapKey(connection, KEYSYM.ENTER, [KEYSYM.CONTROL, KEYSYM.SHIFT])
        expect(calls).toEqual([
            `down:${KEYSYM.CONTROL.toString(16)}`,
            `down:${KEYSYM.SHIFT.toString(16)}`,
            `down:${KEYSYM.ENTER.toString(16)}`,
            `up:${KEYSYM.SHIFT.toString(16)}`,
            `up:${KEYSYM.CONTROL.toString(16)}`,
        ])
    })

    it('tapKey 无修饰键：只敲一次键，无括号', () => {
        const { connection, calls } = fakeKeyboard()
        tapKey(connection, KEYSYM.ESCAPE)
        expect(calls).toEqual([`down:${KEYSYM.ESCAPE.toString(16)}`])
    })

    it('sendBackspaces：N 个退格共用一次修饰键括号', () => {
        const { connection, calls } = fakeKeyboard()
        sendBackspaces(connection, 3, [KEYSYM.ALT])
        expect(calls).toEqual([
            `down:${KEYSYM.ALT.toString(16)}`,
            `down:${KEYSYM.BACKSPACE.toString(16)}`,
            `down:${KEYSYM.BACKSPACE.toString(16)}`,
            `down:${KEYSYM.BACKSPACE.toString(16)}`,
            `up:${KEYSYM.ALT.toString(16)}`,
        ])
    })

    it('sendText：空文本零动作（含不发修饰键）', () => {
        const { connection, calls } = fakeKeyboard()
        sendText(connection, '', [KEYSYM.SHIFT])
        expect(calls).toEqual([])
        sendText(connection, 'ab', [])
        expect(calls).toEqual(['text:ab'])
    })

    it('组合器接受 DesktopViewConnection 形状（结构最小面）', () => {
        const connection = {
            sendKey: vi.fn(),
            sendText: vi.fn(),
            disconnect: vi.fn(),
            setViewOnly: vi.fn(),
            requestResize: vi.fn(),
        }
        tapKey(connection, KEYSYM.TAB, [KEYSYM.META])
        expect(connection.sendKey).toHaveBeenNthCalledWith(1, KEYSYM.META, true)
        expect(connection.sendKey).toHaveBeenNthCalledWith(2, KEYSYM.TAB)
        expect(connection.sendKey).toHaveBeenNthCalledWith(3, KEYSYM.META, false)
    })
})
