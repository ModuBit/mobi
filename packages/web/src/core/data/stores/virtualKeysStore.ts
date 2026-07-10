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

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/** 虚拟按键：移动端无键盘时，触发特殊键/组合键的快捷按钮 */
export interface VirtualKey {
    /** 稳定 id（持久化标识，编辑/排序用） */
    id: string
    /** 显示文本（如 "Ctrl+C"、"↑"） */
    label: string
    /** 发送到终端的字节序列（如 "\x03"、"\x1b[A"） */
    data: string
}

/**
 * 默认虚拟按键预设。
 * 方向键用 normal cursor mode 序列（\x1b[A 等）；多数 shell/REPL 默认即此模式。
 */
export const DEFAULT_VIRTUAL_KEYS: VirtualKey[] = [
    { id: 'ctrl-c', label: 'Ctrl+C', data: '\x03' },
    { id: 'tab', label: 'Tab', data: '\t' },
    { id: 'shift-tab', label: 'Shift+Tab', data: '\x1b[Z' },
    { id: 'esc', label: 'Esc', data: '\x1b' },
    { id: 'up', label: '↑', data: '\x1b[A' },
    { id: 'down', label: '↓', data: '\x1b[B' },
    { id: 'right', label: '→', data: '\x1b[C' },
    { id: 'left', label: '←', data: '\x1b[D' },
]

interface VirtualKeysState {
    /** 当前虚拟按键列表（用户可增删改排序） */
    keys: VirtualKey[]
    /** 整体替换（编辑 Drawer 保存时调用） */
    setKeys: (keys: VirtualKey[]) => void
}

/**
 * 虚拟按键 store，persist 到 localStorage（key: mobi-virtual-keys）。
 * 全局共享（所有终端实例用同一套配置）。
 */
export const useVirtualKeysStore = create<VirtualKeysState>()(
    persist(
        (set) => ({
            keys: DEFAULT_VIRTUAL_KEYS,
            setKeys: (keys) => set({ keys }),
        }),
        {
            name: 'mobi-virtual-keys',
            merge: (persistedState, currentState) => ({
                ...currentState,
                ...(persistedState as Partial<VirtualKeysState>),
            }),
        }
    )
)
