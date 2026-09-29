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
 * DiffTarget resolver 单测（审查重写 v2 票04）：ref 对照表逐行断言 + 非 git 降级 +
 * turnIndex 越界。快照链用内存 fake（seam 契约见 turnSnapshotStore.test.ts）。
 */

import { describe, expect, it } from 'vitest'
import { resolveDiffTarget } from '@/modules/common/git/diffTargetResolver'
import { createInMemoryTurnSnapshotStore } from '@/modules/common/git/turnSnapshotStore'

describe('resolveDiffTarget（ref 对照表）', () => {
    it('turn 缺省 = 链尾两树；diffArgs 为两 tree sha', async () => {
        const store = createInMemoryTurnSnapshotStore({
            chains: { s: [{ index: 1, tree: 't1' }, { index: 2, tree: 't2' }] },
        })
        const resolved = await resolveDiffTarget('s', { kind: 'turn' }, { isGitRepository: true, snapshotStore: store })
        expect(resolved).toMatchObject({ isGitRepository: true, toolSourceOnly: false, baseRev: 't1', headRev: 't2', diffArgs: ['t1', 't2'] })
    })

    it('turn 带 turnIndex = 链上该序号与其前一颗', async () => {
        const store = createInMemoryTurnSnapshotStore({
            chains: { s: [{ index: 1, tree: 't1' }, { index: 2, tree: 't2' }, { index: 3, tree: 't3' }] },
        })
        const resolved = await resolveDiffTarget('s', { kind: 'turn', turnIndex: 3 }, { isGitRepository: true, snapshotStore: store })
        expect(resolved).toMatchObject({ baseRev: 't2', headRev: 't3' })
    })

    it('turnIndex 越界：抛错（明确请求了不存在的轮次）；链空（tail）与 store null：降级 journal 供数', async () => {
        const store = createInMemoryTurnSnapshotStore({ chains: { s: [{ index: 1, tree: 't1' }] } })
        await expect(resolveDiffTarget('s', { kind: 'turn', turnIndex: 9 }, { isGitRepository: true, snapshotStore: store })).rejects.toThrow(/not found/)
        // 链空（init 后首查的常态路径）：journal 兜底，与 overview 的 turn 统计同语义
        const empty = createInMemoryTurnSnapshotStore()
        expect(await resolveDiffTarget('s', { kind: 'turn' }, { isGitRepository: true, snapshotStore: empty }))
            .toMatchObject({ isGitRepository: true, toolSourceOnly: true, baseRev: null, headRev: null })
        expect(await resolveDiffTarget('s', { kind: 'turn' }, { isGitRepository: true, snapshotStore: null }))
            .toMatchObject({ isGitRepository: true, toolSourceOnly: true })
    })

    it('worktree 三档：uncommitted=HEAD vs 工作区、unstaged=index vs 工作区、staged=HEAD vs index', async () => {
        const resolved = (area: 'uncommitted' | 'unstaged' | 'staged') =>
            resolveDiffTarget('s', { kind: 'worktree', area }, { isGitRepository: true, snapshotStore: null })
        expect(await resolved('uncommitted')).toMatchObject({ baseRev: 'HEAD', headRev: null, diffArgs: ['HEAD'] })
        expect(await resolved('unstaged')).toMatchObject({ baseRev: '', headRev: null, diffArgs: [] })
        expect(await resolved('staged')).toMatchObject({ baseRev: 'HEAD', headRev: '', diffArgs: ['--cached', 'HEAD'] })
    })

    it('commit 档 = range 两 ref 原样', async () => {
        const resolved = await resolveDiffTarget('s', { kind: 'commit', range: { base: 'aaa', head: 'bbb' } }, { isGitRepository: true, snapshotStore: null })
        expect(resolved).toMatchObject({ baseRev: 'aaa', headRev: 'bbb', diffArgs: ['aaa', 'bbb'] })
    })

    it('非 git：turn 档 toolSourceOnly（journal 全权供数），git 系不带 ref 对', async () => {
        const resolved = (target: Parameters<typeof resolveDiffTarget>[1]) =>
            resolveDiffTarget('s', target, { isGitRepository: false, snapshotStore: null })
        expect(await resolved({ kind: 'turn' })).toMatchObject({ isGitRepository: false, toolSourceOnly: true, baseRev: null, headRev: null })
        expect(await resolved({ kind: 'worktree', area: 'uncommitted' })).toMatchObject({ isGitRepository: false, toolSourceOnly: false })
        expect(await resolved({ kind: 'commit', range: { base: 'a', head: 'b' } })).toMatchObject({ isGitRepository: false, toolSourceOnly: false })
    })
})
