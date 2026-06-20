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

    it('getSession 未记录返回默认值（收起、0.5、空 tabs、null activeTabId、chatHidden=false）', () => {
        expect(useWorkspaceStore.getState().getSession('s1')).toEqual(DEFAULT_INSPECTOR_STATE)
        expect(DEFAULT_INSPECTOR_STATE).toEqual({
            expanded: false,
            splitRatio: 0.5,
            chatHidden: false,
            tabs: [],
            activeTabId: null,
        })
    })

    it('setExpanded / setSplitRatio / setChatHidden 按 session 隔离', () => {
        useWorkspaceStore.getState().setExpanded('s1', true)
        useWorkspaceStore.getState().setSplitRatio('s1', 0.7)
        useWorkspaceStore.getState().setChatHidden('s2', true)

        expect(useWorkspaceStore.getState().getSession('s1')).toEqual({
            expanded: true, splitRatio: 0.7, chatHidden: false, tabs: [], activeTabId: null,
        })
        expect(useWorkspaceStore.getState().getSession('s2').chatHidden).toBe(true)
    })

    it('setter 值相等短路：不产生新 sessions 引用', () => {
        useWorkspaceStore.getState().setExpanded('s1', true)
        const before = useWorkspaceStore.getState().sessions
        useWorkspaceStore.getState().setExpanded('s1', true)
        expect(useWorkspaceStore.getState().sessions).toBe(before)
        useWorkspaceStore.getState().setSplitRatio('s1', 0.7)
        expect(useWorkspaceStore.getState().sessions).not.toBe(before)
    })

    it('openFileTreeTab 新增 tree tab 并激活', () => {
        useWorkspaceStore.getState().openFileTreeTab('s1')
        const s = useWorkspaceStore.getState().getSession('s1')
        expect(s.tabs).toHaveLength(1)
        expect(s.tabs[0].mode).toBe('tree')
        expect(s.activeTabId).toBe(s.tabs[0].id)
    })

    it('openFileInTab 未命中：当前 tree tab 转为 file tab，保留 id', () => {
        useWorkspaceStore.getState().openFileTreeTab('s1')
        const treeId = useWorkspaceStore.getState().getSession('s1').tabs[0].id
        useWorkspaceStore.getState().openFileInTab('s1', treeId, 'src/a.ts', 'a.ts')

        const s = useWorkspaceStore.getState().getSession('s1')
        expect(s.tabs).toHaveLength(1)
        expect(s.tabs[0]).toMatchObject({ id: treeId, mode: 'file', filePath: 'src/a.ts', fileName: 'a.ts' })
        expect(s.activeTabId).toBe(treeId)
    })

    it('openFileInTab 命中已存在文件：不新增，切激活到原 tab', () => {
        useWorkspaceStore.getState().openFileTreeTab('s1')
        const t1 = useWorkspaceStore.getState().getSession('s1').tabs[0].id
        useWorkspaceStore.getState().openFileInTab('s1', t1, 'src/a.ts', 'a.ts')

        // 第二个 tree tab，尝试打开同一个文件 → 去重
        useWorkspaceStore.getState().openFileTreeTab('s1')
        const t2 = useWorkspaceStore.getState().getSession('s1').tabs[1].id
        useWorkspaceStore.getState().openFileInTab('s1', t2, 'src/a.ts', 'a.ts')

        const s = useWorkspaceStore.getState().getSession('s1')
        expect(s.tabs).toHaveLength(2)
        expect(s.tabs[0].filePath).toBe('src/a.ts')
        expect(s.tabs[1].mode).toBe('tree') // 第二个未被转换
        expect(s.activeTabId).toBe(t1) // 切回已存在的文件 tab
    })

    it('closeTab 关闭非末位 tab：保留 active', () => {
        useWorkspaceStore.getState().openFileTreeTab('s1')
        useWorkspaceStore.getState().openFileTreeTab('s1')
        const [t1, t2] = useWorkspaceStore.getState().getSession('s1').tabs.map(t => t.id)
        useWorkspaceStore.getState().setActiveTab('s1', t2)
        useWorkspaceStore.getState().closeTab('s1', t1)
        const s = useWorkspaceStore.getState().getSession('s1')
        expect(s.tabs).toHaveLength(1)
        expect(s.tabs[0].id).toBe(t2)
        expect(s.activeTabId).toBe(t2)
    })

    it('closeTab 关闭 active：激活左侧相邻', () => {
        useWorkspaceStore.getState().openFileTreeTab('s1')
        useWorkspaceStore.getState().openFileTreeTab('s1')
        const [t1, t2] = useWorkspaceStore.getState().getSession('s1').tabs.map(t => t.id)
        useWorkspaceStore.getState().setActiveTab('s1', t2)
        useWorkspaceStore.getState().closeTab('s1', t2)
        expect(useWorkspaceStore.getState().getSession('s1').activeTabId).toBe(t1)
    })

    it('closeTab 归空：收起 inspector', () => {
        useWorkspaceStore.getState().setExpanded('s1', true)
        useWorkspaceStore.getState().openFileTreeTab('s1')
        const t1 = useWorkspaceStore.getState().getSession('s1').tabs[0].id
        useWorkspaceStore.getState().closeTab('s1', t1)
        const s = useWorkspaceStore.getState().getSession('s1')
        expect(s.tabs).toHaveLength(0)
        expect(s.activeTabId).toBeNull()
        expect(s.expanded).toBe(false)
    })

    it('setActiveTab 设置激活', () => {
        useWorkspaceStore.getState().openFileTreeTab('s1')
        useWorkspaceStore.getState().openFileTreeTab('s1')
        const [t1, t2] = useWorkspaceStore.getState().getSession('s1').tabs.map(t => t.id)
        useWorkspaceStore.getState().setActiveTab('s1', t1)
        expect(useWorkspaceStore.getState().getSession('s1').activeTabId).toBe(t1)
        useWorkspaceStore.getState().setActiveTab('s1', t2)
        expect(useWorkspaceStore.getState().getSession('s1').activeTabId).toBe(t2)
    })

    it('clearSession 清理指定 session，不影响其它', () => {
        useWorkspaceStore.getState().setExpanded('s1', true)
        useWorkspaceStore.getState().setExpanded('s2', true)
        useWorkspaceStore.getState().clearSession('s1')
        expect(useWorkspaceStore.getState().getSession('s1')).toEqual(DEFAULT_INSPECTOR_STATE)
        expect(useWorkspaceStore.getState().getSession('s2').expanded).toBe(true)
    })

    it('clearSession 不存在为 no-op', () => {
        const before = useWorkspaceStore.getState().sessions
        useWorkspaceStore.getState().clearSession('never-exists')
        expect(useWorkspaceStore.getState().sessions).toBe(before)
    })

    it('未挂载 persist 中间件', () => {
        expect((useWorkspaceStore as unknown as { persist?: unknown }).persist).toBeUndefined()
    })
})
