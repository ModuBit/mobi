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

import { describe, it, expect, beforeEach } from 'vitest'
import { useWorkspaceStore, DEFAULT_INSPECTOR_STATE } from '@/core/data/stores/workspaceStore'

describe('workspaceStore', () => {
    beforeEach(() => {
        useWorkspaceStore.getState().clearAll()
    })

    it('getSession 未记录返回默认值（收起、0.5、files）', () => {
        expect(useWorkspaceStore.getState().getSession('s1')).toEqual(DEFAULT_INSPECTOR_STATE)
        expect(DEFAULT_INSPECTOR_STATE).toEqual({ expanded: false, splitRatio: 0.5, activeTab: 'files' })
    })

    it('setExpanded / setSplitRatio / setActiveTab 按 session 隔离', () => {
        useWorkspaceStore.getState().setExpanded('s1', true)
        useWorkspaceStore.getState().setActiveTab('s2', 'terminal')
        useWorkspaceStore.getState().setSplitRatio('s1', 0.7)

        expect(useWorkspaceStore.getState().getSession('s1')).toEqual({
            expanded: true, splitRatio: 0.7, activeTab: 'files',
        })
        expect(useWorkspaceStore.getState().getSession('s2')).toEqual({
            expanded: false, splitRatio: 0.5, activeTab: 'terminal',
        })
    })

    it('set 方法在无记录时以默认值为基底合并', () => {
        useWorkspaceStore.getState().setExpanded('s1', true)
        expect(useWorkspaceStore.getState().getSession('s1').splitRatio).toBe(0.5)
    })

    it('clearSession 清理指定 session，不影响其它', () => {
        useWorkspaceStore.getState().setExpanded('s1', true)
        useWorkspaceStore.getState().setExpanded('s2', true)
        useWorkspaceStore.getState().clearSession('s1')
        expect(useWorkspaceStore.getState().getSession('s1')).toEqual(DEFAULT_INSPECTOR_STATE)
        expect(useWorkspaceStore.getState().getSession('s2').expanded).toBe(true)
    })

    it('clearSession 清理不存在的 session 为 no-op', () => {
        const before = useWorkspaceStore.getState().sessions
        useWorkspaceStore.getState().clearSession('never-exists')
        // 同一引用（未产生新 Map）
        expect(useWorkspaceStore.getState().sessions).toBe(before)
    })

    it('未挂载 persist 中间件（状态仅存内存）', () => {
        // 无 persist 时 store 对象上不存在 .persist 属性
        expect((useWorkspaceStore as unknown as { persist?: unknown }).persist).toBeUndefined()
    })
})
