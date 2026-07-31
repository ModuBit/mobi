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
 * 诊断埋点（diag）单元测试
 * 验证：默认关闭 / 记录 / 聚合状态史 / clear / disable / localStorage 恢复 / 全局接口
 */

import { describe, it, expect, afterEach } from 'vitest'
import {
    enableDiag,
    disableDiag,
    isDiagEnabled,
    recordSnapshot,
    recordTool,
    dumpDiag,
    initDiag,
} from '@/core/lib/diag'

const LS_ENABLED_KEY = 'mobi-diag-enabled'
const LS_DATA_KEY = 'mobi-diag-data'

describe('diag 诊断埋点', () => {
    afterEach(() => {
        disableDiag()
        localStorage.clear()
        // 清 URL 参数，避免 ?diag 影响后续测试
        window.history.replaceState({}, '', window.location.pathname)
    })

    it('默认关闭：记录被忽略', () => {
        recordSnapshot({ kind: 'snapshot', snapshot: true, messageId: 'm1', localId: null, role: 'agent', content: {} })
        recordTool({ kind: 'tool', toolUseId: 't1', name: 'Write', stage: 'created', state: 'running', permission: undefined, source: 'message' })
        expect(isDiagEnabled()).toBe(false)
        expect(dumpDiag().events).toHaveLength(0)
        expect(dumpDiag().tools).toHaveLength(0)
    })

    it('enableDiag 后记录 snapshot 与 tool 事件', () => {
        enableDiag()
        recordSnapshot({ kind: 'snapshot', snapshot: true, messageId: 'm1', localId: 'l1', role: 'agent', content: { x: 1 } })
        recordTool({ kind: 'tool', toolUseId: 't1', name: 'Write', stage: 'created', state: 'running', permission: undefined, source: 'message' })
        const d = dumpDiag()
        expect(isDiagEnabled()).toBe(true)
        expect(d.events).toHaveLength(2)
        expect(d.tools).toHaveLength(1)
        expect(d.tools[0].toolUseId).toBe('t1')
        expect(d.tools[0].name).toBe('Write')
    })

    it('同一 toolUseId 聚合状态史', () => {
        enableDiag()
        recordTool({ kind: 'tool', toolUseId: 't1', name: 'Write', stage: 'created', state: 'running', permission: undefined, source: 'message' })
        recordTool({ kind: 'tool', toolUseId: 't1', name: 'Write', stage: 'state', state: 'pending', permission: { id: 't1', status: 'pending' }, source: 'permission' })
        recordTool({ kind: 'tool', toolUseId: 't1', name: 'Write', stage: 'state', state: 'completed', permission: undefined, source: 'message' })
        const d = dumpDiag()
        expect(d.tools).toHaveLength(1)
        expect(d.tools[0].events).toHaveLength(3)
        // 状态史含 pending 权限（permission 摘要入史）
        expect(d.tools[0].events.some(e => e.startsWith('state:pending'))).toBe(true)
    })

    it('created 事件按 toolUseId 去重：reducer 全量重跑不重复记录', () => {
        enableDiag()
        // 模拟 snapshot 反复重放同一工具（reducer 每次全量重跑都会走 ensureToolBlock）
        recordTool({ kind: 'tool', toolUseId: 't1', name: 'Write', stage: 'created', state: 'running', permission: undefined, source: 'message' })
        recordTool({ kind: 'tool', toolUseId: 't1', name: 'Write', stage: 'created', state: 'running', permission: undefined, source: 'message' })
        recordTool({ kind: 'tool', toolUseId: 't1', name: 'Write', stage: 'created', state: 'running', permission: undefined, source: 'message' })
        const d = dumpDiag()
        expect(d.tools).toHaveLength(1)
        // created 只记一次，state 事件照记
        expect(d.tools[0].events.filter(e => e.startsWith('created:'))).toHaveLength(1)
        expect(d.events.filter(e => e.kind === 'tool' && e.stage === 'created')).toHaveLength(1)
    })

    it('state 事件按 (state, permission 值) 去重：同值重放只记一次', () => {
        enableDiag()
        // 首次记录 pending
        recordTool({ kind: 'tool', toolUseId: 't1', name: 'Write', stage: 'state', state: 'pending', permission: { id: 't1', status: 'pending' }, source: 'existing' })
        // 同值重放（reducer 全量重跑，permission 值相同）→ 跳过
        recordTool({ kind: 'tool', toolUseId: 't1', name: 'Write', stage: 'state', state: 'pending', permission: { id: 't1', status: 'pending' }, source: 'existing' })
        // 值变化（pending → approved）→ 记录
        recordTool({ kind: 'tool', toolUseId: 't1', name: 'Write', stage: 'state', state: 'running', permission: { id: 't1', status: 'approved', date: 123 }, source: 'existing' })
        // 同值再重放 → 跳过
        recordTool({ kind: 'tool', toolUseId: 't1', name: 'Write', stage: 'state', state: 'running', permission: { id: 't1', status: 'approved', date: 123 }, source: 'existing' })
        const d = dumpDiag()
        expect(d.tools[0].events.filter(e => e.startsWith('state:'))).toHaveLength(2)
    })

    it('clear 清空事件与状态史', () => {
        enableDiag()
        // 全局对象由 initDiag 挂载（生产在 main 启动时调用），测试模拟真实用法先 init
        initDiag()
        recordTool({ kind: 'tool', toolUseId: 't1', name: 'Write', stage: 'created', state: 'running', permission: undefined, source: 'message' })
        ;(window as unknown as { __mobiDiag: { clear: () => void } }).__mobiDiag.clear()
        expect(dumpDiag().events).toHaveLength(0)
        expect(dumpDiag().tools).toHaveLength(0)
    })

    it('disable 关闭并清空', () => {
        enableDiag()
        recordTool({ kind: 'tool', toolUseId: 't1', name: 'Write', stage: 'created', state: 'running', permission: undefined, source: 'message' })
        disableDiag()
        expect(isDiagEnabled()).toBe(false)
        expect(dumpDiag().events).toHaveLength(0)
        expect(localStorage.getItem(LS_ENABLED_KEY)).toBeNull()
    })

    it('localStorage 标记开启时 initDiag 自动开启并合并现场', () => {
        // 预置上次会话的镜像（模拟刷新前留下的数据）
        localStorage.setItem(LS_DATA_KEY, JSON.stringify({
            version: '1',
            enabled: true,
            createdAt: 0,
            events: [{ kind: 'snapshot', snapshot: true, messageId: 'm1', localId: null, role: 'agent', content: {} }],
            tools: [{ toolUseId: 't1', name: 'Write', events: ['created:running'], firstSeen: 0, lastSeen: 0 }],
        }))
        localStorage.setItem(LS_ENABLED_KEY, '1')
        initDiag()
        expect(isDiagEnabled()).toBe(true)
        const d = dumpDiag()
        expect(d.events).toHaveLength(1)
        expect(d.tools).toHaveLength(1)
        // 新事件在旧现场之后继续追加
        recordTool({ kind: 'tool', toolUseId: 't2', name: 'Read', stage: 'created', state: 'running', permission: undefined, source: 'message' })
        expect(dumpDiag().tools).toHaveLength(2)
    })

    it('URL ?diag=1 开启、?diag=0 关闭', () => {
        window.history.replaceState({}, '', `${window.location.pathname}?diag=1`)
        initDiag()
        expect(isDiagEnabled()).toBe(true)
        disableDiag()
        window.history.replaceState({}, '', `${window.location.pathname}?diag=0`)
        initDiag()
        expect(isDiagEnabled()).toBe(false)
    })

    it('window.__mobiDiag.dump() 返回可 JSON 序列化的数据', () => {
        enableDiag()
        initDiag()
        recordTool({ kind: 'tool', toolUseId: 't1', name: 'Write', stage: 'created', state: 'running', permission: undefined, source: 'message' })
        const w = window as unknown as { __mobiDiag: { dump: () => unknown } }
        const dumped = w.__mobiDiag.dump()
        expect(() => JSON.stringify(dumped)).not.toThrow()
        expect((dumped as { events: unknown[] }).events).toHaveLength(1)
        expect((dumped as { tools: unknown[] }).tools).toHaveLength(1)
    })
})
