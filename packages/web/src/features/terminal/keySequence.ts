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

/** 修饰键 */
export type Modifier = 'ctrl' | 'alt' | 'shift'

export const MODIFIERS: { id: Modifier; label: string }[] = [
    { id: 'ctrl', label: 'Ctrl' },
    { id: 'alt', label: 'Alt' },
    { id: 'shift', label: 'Shift' },
]

/** 主键选项（供 Picker 渲染） */
export interface MainKeyOption {
    id: string
    label: string
}

/** 主键分组 */
export interface MainKeyGroup {
    title: string
    keys: MainKeyOption[]
}

/** 主键分组（字母 / 数字 / 方向 / 编辑 / 导航 / 功能键） */
export const MAIN_KEY_GROUPS: MainKeyGroup[] = [
    {
        title: '字母',
        keys: 'abcdefghijklmnopqrstuvwxyz'.split('').map((c) => ({ id: c, label: c.toUpperCase() })),
    },
    {
        title: '数字',
        keys: '0123456789'.split('').map((c) => ({ id: c, label: c })),
    },
    {
        title: '方向',
        keys: [
            { id: 'arrowup', label: '↑' },
            { id: 'arrowdown', label: '↓' },
            { id: 'arrowleft', label: '←' },
            { id: 'arrowright', label: '→' },
        ],
    },
    {
        title: '编辑',
        keys: [
            { id: 'tab', label: 'Tab' },
            { id: 'esc', label: 'Esc' },
            { id: 'enter', label: '↵' },
            { id: 'backspace', label: '⌫' },
            { id: 'space', label: 'Space' },
        ],
    },
    {
        title: '导航',
        keys: [
            { id: 'home', label: 'Home' },
            { id: 'end', label: 'End' },
            { id: 'pageup', label: 'PgUp' },
            { id: 'pagedown', label: 'PgDn' },
            { id: 'insert', label: 'Ins' },
            { id: 'delete', label: 'Del' },
        ],
    },
    {
        title: '功能',
        keys: Array.from({ length: 12 }, (_, i) => ({ id: `f${i + 1}`, label: `F${i + 1}` })),
    },
]

export interface BuiltKey {
    label: string
    data: string
}

/** xterm 修饰码：none=1 shift=+1 alt=+2 ctrl=+4（1-8） */
function modifierCode(mods: Modifier[]): number {
    let m = 1
    if (mods.includes('shift')) m += 1
    if (mods.includes('alt')) m += 2
    if (mods.includes('ctrl')) m += 4
    return m
}

/** 修饰键 label，按 Ctrl→Alt→Shift 固定顺序 */
function modLabels(mods: Modifier[]): string[] {
    return (['ctrl', 'alt', 'shift'] as Modifier[]).filter((m) => mods.includes(m)).map((m) => MODIFIERS.find((x) => x.id === m)!.label)
}

/**
 * 由修饰键 + 主键 id 生成终端按键序列（label + 字节 data）。
 * 不支持的组合返回 null（Picker 据此禁用确认）。
 *
 * 字节编码遵循 xterm：Ctrl+字母=控制码；方向/导航/功能键用 CSI 序列，修饰用 ;{code}。
 */
export function buildKeySequence(mods: Modifier[], keyId: string): BuiltKey | null {
    const ml = modLabels(mods)
    const has = (m: Modifier) => mods.includes(m)
    const mc = modifierCode(mods)
    const join = (keyLabel: string) => [...ml, keyLabel].join('+')

    // 字母 a-z
    if (/^[a-z]$/.test(keyId)) {
        const upper = keyId.toUpperCase()
        if (has('ctrl')) {
            // Ctrl+letter = 控制码 1-26（a=\x01 ... z=\x1a）；Alt 再前缀 \x1b
            let data = String.fromCharCode(keyId.charCodeAt(0) - 96)
            if (has('alt')) data = '\x1b' + data
            return { label: join(upper), data }
        }
        let data = upper
        if (has('alt')) data = '\x1b' + upper
        return { label: join(upper), data }
    }

    // 数字 0-9（不支持 Ctrl）
    if (/^[0-9]$/.test(keyId)) {
        if (has('ctrl')) return null
        let data = keyId
        if (has('alt')) data = '\x1b' + keyId
        return { label: join(keyId), data }
    }

    // 方向键
    const arrowOf: Record<string, string> = { arrowup: 'A', arrowdown: 'B', arrowright: 'C', arrowleft: 'D' }
    const arrowSym: Record<string, string> = { arrowup: '↑', arrowdown: '↓', arrowright: '→', arrowleft: '←' }
    if (arrowOf[keyId]) {
        const X = arrowOf[keyId]
        const data = mc > 1 ? `\x1b[1;${mc}${X}` : `\x1b[${X}`
        return { label: join(arrowSym[keyId]), data }
    }

    // Tab（Shift+Tab = \x1b[Z；Ctrl/Alt+Tab 无通用标准序列，禁用避免发编造码）
    if (keyId === 'tab') {
        if (mc === 1) return { label: join('Tab'), data: '\t' }
        if (has('shift') && !has('ctrl') && !has('alt')) return { label: join('Tab'), data: '\x1b[Z' }
        return null
    }

    if (keyId === 'esc') {
        let data = '\x1b'
        if (has('alt')) data = '\x1b\x1b'
        return { label: join('Esc'), data }
    }
    if (keyId === 'enter') {
        let data = '\r'
        if (has('alt')) data = '\x1b\r'
        return { label: join('↵'), data }
    }
    if (keyId === 'backspace') {
        // Ctrl+Backspace 部分终端用 \x08，其余 \x7f
        return { label: join('⌫'), data: has('ctrl') ? '\x08' : '\x7f' }
    }
    if (keyId === 'space') {
        if (has('ctrl')) {
            let data = '\x00'
            if (has('alt')) data = '\x1b\x00'
            return { label: join('Space'), data }
        }
        return { label: join('Space'), data: has('alt') ? '\x1b ' : ' ' }
    }

    // 导航键（CSI ~ 形式，支持修饰码）
    const csiNum: Record<string, string> = { home: '1', insert: '2', delete: '3', end: '4', pageup: '5', pagedown: '6' }
    const csiLabel: Record<string, string> = { home: 'Home', insert: 'Insert', delete: 'Delete', end: 'End', pageup: 'PgUp', pagedown: 'PgDn' }
    if (csiNum[keyId]) {
        const n = csiNum[keyId]
        const data = mc > 1 ? `\x1b[${n};${mc}~` : `\x1b[${n}~`
        return { label: join(csiLabel[keyId]), data }
    }

    // 功能键 F1-F12
    const fMatch = /^f(\d+)$/.exec(keyId)
    if (fMatch) {
        const n = Number(fMatch[1])
        const labelName = `F${n}`
        const f1_4: Record<number, string> = { 1: 'P', 2: 'Q', 3: 'R', 4: 'S' }
        if (n <= 4) {
            if (mc > 1) return null // F1-F4 的修饰码序列不通用，禁用
            return { label: join(labelName), data: `\x1bO${f1_4[n]}` }
        }
        const codes: Record<number, number> = { 5: 15, 6: 17, 7: 18, 8: 19, 9: 20, 10: 21, 11: 23, 12: 24 }
        const code = codes[n]
        const data = mc > 1 ? `\x1b[${code};${mc}~` : `\x1b[${code}~`
        return { label: join(labelName), data }
    }

    return null
}
