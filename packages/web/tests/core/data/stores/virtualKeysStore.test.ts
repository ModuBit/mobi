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

import { describe, it, expect, beforeEach, vi } from 'vitest'

// persist store 在 import 时创建并缓存 storage，须在 import store 前 stub localStorage
vi.hoisted(() => {
    const store: Record<string, string> = {}
    vi.stubGlobal('localStorage', {
        getItem: (k: string) => (k in store ? store[k] : null),
        setItem: (k: string, v: string) => {
            store[k] = v
        },
        removeItem: (k: string) => {
            delete store[k]
        },
        clear: () => {
            Object.keys(store).forEach((k) => delete store[k])
        },
    })
})

import {
    useVirtualKeysStore,
    DEFAULT_VIRTUAL_KEYS,
} from '@/core/data/stores/virtualKeysStore'

describe('useVirtualKeysStore', () => {
    beforeEach(() => {
        // 重置为默认预设，隔离用例
        useVirtualKeysStore.setState({ keys: DEFAULT_VIRTUAL_KEYS })
    })

    it('默认预设 8 个：Ctrl+C / Tab / Shift+Tab / Esc / 方向键，data 为真实字节', () => {
        const keys = useVirtualKeysStore.getState().keys
        expect(keys).toHaveLength(8)
        expect(keys.find((k) => k.id === 'ctrl-c')?.data).toBe('\x03')
        expect(keys.find((k) => k.id === 'shift-tab')).toEqual({ id: 'shift-tab', label: 'Shift+Tab', data: '\x1b[Z' })
        expect(keys.find((k) => k.id === 'esc')?.data).toBe('\x1b')
        expect(keys.find((k) => k.id === 'up')?.data).toBe('\x1b[A')
        expect(keys.find((k) => k.id === 'left')?.data).toBe('\x1b[D')
    })

    it('setKeys 整体替换', () => {
        useVirtualKeysStore.getState().setKeys([{ id: 'x', label: 'X', data: 'x' }])
        expect(useVirtualKeysStore.getState().keys).toEqual([{ id: 'x', label: 'X', data: 'x' }])
    })
})
