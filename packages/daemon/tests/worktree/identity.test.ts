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

import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import {
    branchForWorktreeName,
    parseMobiWorktreeLayout,
    worktreesRootForRepo,
    worktreeNameFromBranch,
    worktreePathFor
} from '@/worktree/identity'

describe('worktree 归属约定单源', () => {
    it('目录约定与创建侧一致：<repoParent>/<repoName>-worktrees/<name>', () => {
        expect(worktreesRootForRepo('/home/u/project')).toBe('/home/u/project-worktrees')
        expect(worktreePathFor('/home/u/project', 'fix-auth')).toBe('/home/u/project-worktrees/fix-auth')
    })

    it('分支约定与反解（短名与 refs/heads 完整 ref 都认）', () => {
        expect(branchForWorktreeName('fix-auth')).toBe('mobi-fix-auth')
        expect(worktreeNameFromBranch('mobi-fix-auth')).toBe('fix-auth')
        expect(worktreeNameFromBranch('refs/heads/mobi-fix-auth')).toBe('fix-auth')
        expect(worktreeNameFromBranch('main')).toBeNull()
        expect(worktreeNameFromBranch('mobi-')).toBeNull()
    })

    it('路径反解只在约定布局内命中', () => {
        expect(parseMobiWorktreeLayout('/home/u/project-worktrees/fix-auth')).toEqual({
            repoRoot: '/home/u/project',
            name: 'fix-auth'
        })
        expect(parseMobiWorktreeLayout('/home/u/other-worktrees/fix-auth')?.repoRoot).toBe('/home/u/other')
        expect(parseMobiWorktreeLayout('/home/u/project/src')).toBeNull()
        expect(parseMobiWorktreeLayout(join('/home/u/project-worktrees', '..'))).toBeNull()
    })
})
