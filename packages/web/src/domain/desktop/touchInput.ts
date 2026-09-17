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
 * 移动端触摸输入的纯逻辑（迭代 2，openclaw desktop-mobile-keyboard 参照）。
 *
 * 三件事都在此收敛、与 UI 框架无关以便单测：
 * - 哨兵 textarea 的值 diff（软键盘只经 input value 报告合成文本，须 diff 出
 *   删除/插入才能翻译成远端键盘动作）；
 * - 点按切换的虚拟修饰键状态机（移动端无物理修饰键，点按挂起、被下一个
 *   普通键动作消费）；
 * - 工具栏按键表与 VNC keysym 常量。
 */

/** VNC keysym（noVNC keysym 表常用子集；0xffXX = Latin-1 功能键区） */
export const KEYSYM = {
    BACKSPACE: 0xff08,
    TAB: 0xff09,
    ENTER: 0xff0d,
    ESCAPE: 0xff1b,
    LEFT: 0xff51,
    UP: 0xff52,
    RIGHT: 0xff53,
    DOWN: 0xff54,
    SHIFT: 0xffe1,
    CONTROL: 0xffe3,
    ALT: 0xffe9,
    META: 0xffe7,
} as const

/** 工具栏点按修饰键：点按挂起、被下一个普通键动作消费 */
export interface TouchModifierSpec {
    /** 对应 KeyboardEvent.code（便于测试语义） */
    code: 'ShiftLeft' | 'ControlLeft' | 'AltLeft' | 'MetaLeft'
    label: string
    keysym: number
}

export const TOUCH_MODIFIERS: TouchModifierSpec[] = [
    { code: 'ShiftLeft', label: '⇧', keysym: KEYSYM.SHIFT },
    { code: 'ControlLeft', label: '⌃', keysym: KEYSYM.CONTROL },
    { code: 'AltLeft', label: '⌥', keysym: KEYSYM.ALT },
    { code: 'MetaLeft', label: '⌘', keysym: KEYSYM.META },
]

/** 触摸工具栏常用键 */
export const TOOLBAR_KEYS: Array<{ code: string; label: string; keysym: number }> = [
    { code: 'Escape', label: 'esc', keysym: KEYSYM.ESCAPE },
    { code: 'Tab', label: 'tab', keysym: KEYSYM.TAB },
    { code: 'Enter', label: '⏎', keysym: KEYSYM.ENTER },
    { code: 'ArrowUp', label: '↑', keysym: KEYSYM.UP },
    { code: 'ArrowDown', label: '↓', keysym: KEYSYM.DOWN },
    { code: 'ArrowLeft', label: '←', keysym: KEYSYM.LEFT },
    { code: 'ArrowRight', label: '→', keysym: KEYSYM.RIGHT },
    { code: 'Backspace', label: '⌫', keysym: KEYSYM.BACKSPACE },
]

/**
 * 哨兵 textarea 的值 diff（openclaw 同款算法）：
 * 公共前缀之后的 prev 部分是被删除的内容（按 Unicode 码点数计——DOM offset 是
 * UTF-16，被删的增补字符也是一次删除动作），next 余下部分是插入文本。
 */
export function diffSentinelValue(prev: string, next: string): { backspaces: number; inserted: string } {
    let prefixLength = 0
    for (const character of prev) {
        if (!next.startsWith(character, prefixLength)) {
            break
        }
        prefixLength += character.length
    }
    return {
        backspaces: Array.from(prev.slice(prefixLength)).length,
        inserted: next.slice(prefixLength),
    }
}

/** 虚拟修饰键的挂起集合：点按 toggle、普通键动作 consume、控制权丢失 clear */
export class TouchModifierState {
    private active = new Set<string>()

    /** 点按：切捔回 true=挂起中 */
    toggle(code: TouchModifierSpec['code']): boolean {
        if (this.active.has(code)) {
            this.active.delete(code)
            return false
        }
        this.active.add(code)
        return true
    }

    isActive(code: TouchModifierSpec['code']): boolean {
        return this.active.has(code)
    }

    /** 普通键动作前的消费：返回挂起修饰键的 keysym（按下顺序）并清空，调用方负责动作后释放 */
    consume(): number[] {
        const keysyms: number[] = []
        for (const spec of TOUCH_MODIFIERS) {
            if (this.active.has(spec.code)) {
                keysyms.push(spec.keysym)
            }
        }
        this.active.clear()
        return keysyms
    }

    clear(): void {
        this.active.clear()
    }
}

/** 哨兵 textarea 的固定填充：保证字段里永远有可删除的内容（软键盘删除才表现为 value 变化） */
export const SENTINEL_VALUE = '________________'
