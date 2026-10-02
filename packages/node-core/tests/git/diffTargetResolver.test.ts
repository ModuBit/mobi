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
 * turn 档拒绝（供数反转后归 TurnAttributionProvider，断言随职责迁移）。
 */

import { describe, expect, it } from 'vitest'
import { resolveDiffTarget } from '@/git/diffTargetResolver'

describe('resolveDiffTarget（ref 对照表）', () => {
    it('turn 档拒绝：已交 TurnAttributionProvider 供数（审查 v3 供数反转）', async () => {
        await expect(resolveDiffTarget({ kind: 'turn' }, { isGitRepository: true })).rejects.toThrow(/TurnAttributionProvider/)
    })

    it('worktree 三档：uncommitted=HEAD vs 工作区、unstaged=index vs 工作区、staged=HEAD vs index', async () => {
        const resolved = (area: 'uncommitted' | 'unstaged' | 'staged') =>
            resolveDiffTarget({ kind: 'worktree', area }, { isGitRepository: true })
        expect(await resolved('uncommitted')).toMatchObject({ baseRev: 'HEAD', headRev: null, diffArgs: ['HEAD'] })
        expect(await resolved('unstaged')).toMatchObject({ baseRev: '', headRev: null, diffArgs: [] })
        expect(await resolved('staged')).toMatchObject({ baseRev: 'HEAD', headRev: '', diffArgs: ['--cached', 'HEAD'] })
    })

    it('commit 档 = range 两 ref 原样', async () => {
        const resolved = await resolveDiffTarget({ kind: 'commit', range: { base: 'aaa', head: 'bbb' } }, { isGitRepository: true })
        expect(resolved).toMatchObject({ baseRev: 'aaa', headRev: 'bbb', diffArgs: ['aaa', 'bbb'] })
    })

    it('非 git：git 系不带 ref 对（turn 档拒绝先于非 git 分支）', async () => {
        const resolved = (target: Parameters<typeof resolveDiffTarget>[0]) =>
            resolveDiffTarget(target, { isGitRepository: false })
        expect(await resolved({ kind: 'worktree', area: 'uncommitted' })).toMatchObject({ isGitRepository: false, baseRev: null, headRev: null })
        expect(await resolved({ kind: 'commit', range: { base: 'a', head: 'b' } })).toMatchObject({ isGitRepository: false })
    })
})
