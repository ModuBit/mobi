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
 * worktree 生命周期服务集成测试（真 git + 真磁盘）：列表扫描。
 *
 * 断言只锁外部行为（主树文件内容 / 分支存在性 / 目录存在性 / 结果字段），
 * 不断言 git 命令序列。
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { clearWorktreeStatusCache } from '@/worktree/status'
import {
    WorktreeLifecycleService,
    type WorktreeSessionRow,
    type WorktreeStoreSource
} from '@/worktree/service'
import { git, createTempRepo, type TempRepo } from './testRepo'

async function exists(path: string): Promise<boolean> {
    try {
        await stat(path)
        return true
    } catch {
        return false
    }
}

async function branchExists(repo: string, branch: string): Promise<boolean> {
    return (await git(repo, ['branch', '--list', branch])).trim() !== ''
}

/** 假 store（服务只消费 sessions/workspaces 两个读面，vitest 不下沉 bun:sqlite） */
function createFakeStore() {
    const sessions: WorktreeSessionRow[] = []
    const folders: string[] = []
    let seq = 0
    const store: WorktreeStoreSource & {
        addWorkspace(path: string): void
        addWorktreeSession(worktree: { basePath: string; name: string; worktreePath: string }): WorktreeSessionRow
    } = {
        sessions: { getSessions: () => sessions },
        workspaces: { getAllWorkspaces: () => (folders.length > 0 ? [{ folders: folders.map((path) => ({ path })) }] : []) },
        addWorkspace(path) {
            folders.push(path)
        },
        addWorktreeSession(worktree) {
            seq += 1
            const row: WorktreeSessionRow = {
                id: `session-${seq}`,
                updatedAt: Date.now() + seq,
                metadata: {
                    path: worktree.basePath,
                    worktree: {
                        basePath: worktree.basePath,
                        branch: `mobi-${worktree.name}`,
                        name: worktree.name,
                        worktreePath: worktree.worktreePath,
                        createdAt: Date.now()
                    }
                }
            }
            sessions.push(row)
            return row
        }
    }
    return store
}

describe('WorktreeLifecycleService', () => {
    let temp: TempRepo
    let store: ReturnType<typeof createFakeStore>
    let service: WorktreeLifecycleService
    let runningSessionIds: Set<string>

    beforeEach(async () => {
        clearWorktreeStatusCache()
        temp = await createTempRepo()
        store = createFakeStore()
        runningSessionIds = new Set()
        service = new WorktreeLifecycleService({
            store,
            isSessionRunning: (id) => runningSessionIds.has(id)
        })
    })

    afterEach(async () => {
        clearWorktreeStatusCache()
        await temp.cleanup()
    })

    describe('list', () => {
        it('扫描工作区下的 worktree：字段、脏判定、会话反查、孤儿容错', async () => {
            store.addWorkspace(temp.repo)
            const cleanPath = await temp.addWorktree('clean')
            const dirtyPath = await temp.addWorktree('dirty')
            const orphanPath = await temp.addWorktree('orphan')
            await writeFile(join(dirtyPath, 'change.txt'), 'hello\n')
            const session = store.addWorktreeSession({
                basePath: temp.repo,
                name: 'dirty',
                worktreePath: dirtyPath
            })

            const byName = new Map((await service.list()).map((item) => [item.name, item]))

            expect([...byName.keys()].sort()).toEqual(['clean', 'dirty', 'orphan'])
            expect(byName.get('clean')).toMatchObject({
                branch: 'mobi-clean',
                repoRoot: temp.repo,
                worktreePath: cleanPath,
                state: 'clean',
                dirtyFileCount: 0
            })
            expect(byName.get('clean')?.sessionId).toBeUndefined()
            expect(byName.get('dirty')).toMatchObject({
                state: 'dirty',
                dirtyFileCount: 1,
                sessionId: session.id
            })
            expect(byName.get('orphan')).toMatchObject({ state: 'clean', worktreePath: orphanPath })
            expect(byName.get('clean')?.createdAt).toBeGreaterThan(0)
            expect(byName.get('clean')?.lastCommitAt).toBeGreaterThan(0)
        })

        it('所属会话运行中 → state=running；非 git 工作区容错跳过', async () => {
            store.addWorkspace(temp.repo)
            store.addWorkspace(join(temp.dir, 'not-a-repo'))
            const path = await temp.addWorktree('busy')
            const session = store.addWorktreeSession({ basePath: temp.repo, name: 'busy', worktreePath: path })
            runningSessionIds.add(session.id)

            const list = await service.list()
            expect(list).toHaveLength(1)
            expect(list[0]).toMatchObject({ name: 'busy', state: 'running', sessionId: session.id })
        })

        it('非 mobi 分支 / 非约定路径的 worktree 不入列表', async () => {
            store.addWorkspace(temp.repo)
            await temp.addRawWorktree('foreign', 'feature/x')
            expect(await service.list()).toEqual([])
        })
    })
})
