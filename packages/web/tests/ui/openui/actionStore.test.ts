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
 * actionStore 规格（per-action 粒度票 02 + code-review 2026-10-11）：
 * - applyDerived「只推进不回退」——done/failed 不被扫描派生的 running 打回
 * - setPhase 乐观口不受守卫约束（重跑语义走它）
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { useOpenUIActionStore } from '@/ui/openui/actionStore'

describe('useOpenUIActionStore.applyDerived（终态单调守卫）', () => {
    beforeEach(() => useOpenUIActionStore.getState().clearAll())

    it('done 后派生 running 不打回（rewind 删 result 不复活一次性按钮）', () => {
        const store = useOpenUIActionStore.getState()
        store.applyDerived(new Map([['k1', { phase: 'done' }]]))
        store.applyDerived(new Map([['k1', { phase: 'running' }]]))
        expect(useOpenUIActionStore.getState().phases.get('k1')).toBe('done')
    })

    it('failed 后派生 running 同样不打回', () => {
        const store = useOpenUIActionStore.getState()
        store.applyDerived(new Map([['k1', { phase: 'failed' }]]))
        store.applyDerived(new Map([['k1', { phase: 'running' }]]))
        expect(useOpenUIActionStore.getState().phases.get('k1')).toBe('failed')
    })

    it('idle/queued 态仍被正常推进，守卫只挡终态回退', () => {
        const store = useOpenUIActionStore.getState()
        store.applyDerived(new Map([['k1', { phase: 'running' }]]))
        store.applyDerived(new Map([['k1', { phase: 'done' }]]))
        expect(useOpenUIActionStore.getState().phases.get('k1')).toBe('done')
    })

    it('setPhase 乐观口可越过守卫（repeatable 重跑：done 后再点击回 running）', () => {
        const store = useOpenUIActionStore.getState()
        store.applyDerived(new Map([['k1', { phase: 'done' }]]))
        store.setPhase('k1', 'running')
        expect(useOpenUIActionStore.getState().phases.get('k1')).toBe('running')
    })

    it('守卫命中的条目整条跳过——phase 回退被挡时其快照也不覆盖（终态后陈旧扫描不带新数据）', () => {
        const store = useOpenUIActionStore.getState()
        store.applyDerived(new Map([['k1', { phase: 'done', formState: { a: 1 } }]]))
        store.applyDerived(new Map([['k1', { phase: 'running', formState: { a: 2 } }]]))
        const state = useOpenUIActionStore.getState()
        expect(state.phases.get('k1')).toBe('done')
        expect(state.formStates.get('k1')).toEqual({ a: 1 })
    })
})
