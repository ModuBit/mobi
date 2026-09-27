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
 * 轮次快照存储 seam 的契约测试：内存 fake 是下游票（合成器/审查数据）的测试桩，
 * 它满足的契约即接口契约。git 适配器侧另有真仓库集成测试背书同一接口。
 */

import { describe, it, expect } from 'vitest'
import { createInMemoryTurnSnapshotStore } from '@/modules/common/git/turnSnapshotStore'

describe('createInMemoryTurnSnapshotStore（seam 契约）', () => {
    it('capture：会话内序号从 1 递增，链按 index 升序', async () => {
        const store = createInMemoryTurnSnapshotStore()
        const r1 = await store.capture('s-1')
        const r2 = await store.capture('s-1')
        expect(r1).toEqual({ index: 1, tree: 'fake-tree-1' })
        expect(r2).toEqual({ index: 2, tree: 'fake-tree-2' })
        expect(await store.listChain('s-1')).toEqual([r1, r2])
    })

    it('不同会话链独立；无链 listChain 返回空数组', async () => {
        const store = createInMemoryTurnSnapshotStore()
        await store.capture('s-1')
        expect(await store.listChain('s-2')).toEqual([])
        const r = await store.capture('s-2')
        expect(r.index).toBe(1)
    })

    it('diffTrees：add/delete/modify 三类，无差异返回空数组', async () => {
        const store = createInMemoryTurnSnapshotStore({
            trees: {
                t1: { 'a.txt': ['hello'], 'b.txt': ['x', 'y'], 'c.txt': ['gone'] },
                t2: { 'a.txt': ['hello', 'world'], 'b.txt': ['x', 'changed'], 'c.txt': ['gone'], 'd.txt': ['new'] },
            },
        })
        const entries = await store.diffTrees('t1', 't2')
        expect(entries).toEqual([
            { path: 'a.txt', kind: 'modify', additions: 1, deletions: 0, binary: false },
            { path: 'b.txt', kind: 'modify', additions: 1, deletions: 1, binary: false },
            { path: 'd.txt', kind: 'add', additions: 1, deletions: 0, binary: false },
        ])
        expect(await store.diffTrees('t1', 't1')).toEqual([])
    })

    it('diffTrees：未注册的树按空树处理', async () => {
        const store = createInMemoryTurnSnapshotStore({ trees: { t1: { 'a.txt': ['x'] } } })
        expect(await store.diffTrees('t1', 'unknown')).toEqual([
            { path: 'a.txt', kind: 'delete', additions: 0, deletions: 1, binary: false },
        ])
    })

    it('clearSession：清链并返回数量，幂等', async () => {
        const store = createInMemoryTurnSnapshotStore()
        await store.capture('s-1')
        await store.capture('s-1')
        expect(await store.clearSession('s-1')).toBe(2)
        expect(await store.listChain('s-1')).toEqual([])
        expect(await store.clearSession('s-1')).toBe(0)
    })

    it('预置链：从已有链尾续接（fork/resume 共享链语义）', async () => {
        const store = createInMemoryTurnSnapshotStore({
            chains: { 's-1': [{ index: 3, tree: 't3' }, { index: 7, tree: 't7' }] },
        })
        const next = await store.capture('s-1')
        expect(next.index).toBe(8)
    })
})
