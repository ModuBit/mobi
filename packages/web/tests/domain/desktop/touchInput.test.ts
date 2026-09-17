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

import { describe, expect, it } from 'vitest'
import {
    KEYSYM,
    SENTINEL_VALUE,
    TOOLBAR_KEYS,
    TOUCH_MODIFIERS,
    TouchModifierState,
    diffSentinelValue,
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
