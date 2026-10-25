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

import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { hasStagedChanges, inspectWorktreeStatus, parseDirtyPaths } from '@/worktree/status'
import { git, createTempRepo, type TempRepo } from './testRepo'

describe('脏判定 porcelain 解析', () => {
    it('普通记录与 rename 记录都取变更后路径', () => {
        const output = [' M src/a.ts', '?? new.txt', 'R  new-name.ts\0old-name.ts'].join('\0') + '\0'
        expect(parseDirtyPaths(output)).toEqual(['src/a.ts', 'new.txt', 'new-name.ts'])
    })

    it('.mobi 状态路径被排除（含带尾斜杠的未跟踪目录形态）', () => {
        const output = ['?? .mobi/', '?? .mobi/turn-diffs/x.json', ' M .mobi/journal/a.json', ' M src/a.ts'].join('\0') + '\0'
        expect(parseDirtyPaths(output)).toEqual(['src/a.ts'])
    })

    it('暂存判定只认 index 侧改动', () => {
        expect(hasStagedChanges(' M a.ts\0?? b.ts\0')).toBe(false)
        expect(hasStagedChanges('M  a.ts\0')).toBe(true)
        expect(hasStagedChanges('A  new.ts\0')).toBe(true)
    })
})

describe('inspectWorktreeStatus（真 git 集成）', () => {
    let temp: TempRepo
    let worktreePath: string

    beforeEach(async () => {
        temp = await createTempRepo()
        worktreePath = await temp.addWorktree('s1')
    })

    afterEach(async () => {
        await temp.cleanup()
    })

    it('无改动 → clean', async () => {
        expect(await inspectWorktreeStatus(git, worktreePath)).toEqual({
            state: 'clean',
            dirtyFileCount: 0,
            sizeBytes: 0
        })
    })

    it('用户改动 → dirty，计数与大小只算非 .mobi 文件', async () => {
        await writeFile(join(worktreePath, 'change.txt'), 'hello\n')
        await mkdir(join(worktreePath, '.mobi', 'turn-diffs'), { recursive: true })
        await writeFile(join(worktreePath, '.mobi', 'turn-diffs', 'noise.json'), '{"x":1}\n')

        const status = await inspectWorktreeStatus(git, worktreePath)
        expect(status.state).toBe('dirty')
        expect(status.dirtyFileCount).toBe(1)
        expect(status.sizeBytes).toBe('hello\n'.length)
    })

    it('只有 .mobi 自产文件 → 仍算 clean', async () => {
        await mkdir(join(worktreePath, '.mobi'), { recursive: true })
        await writeFile(join(worktreePath, '.mobi', 'journal.json'), '{}\n')
        expect((await inspectWorktreeStatus(git, worktreePath)).state).toBe('clean')
    })

    it('git 失败（非 git 目录）→ unknown（保守）', async () => {
        const plain = join(temp.dir, 'not-a-repo')
        await mkdir(plain)
        expect((await inspectWorktreeStatus(git, plain)).state).toBe('unknown')
    })
})
