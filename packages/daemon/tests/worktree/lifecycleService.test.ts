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
 * worktree 生命周期服务集成测试（真 git + 真磁盘）：列表扫描、合回两种策略、
 * 冲突回滚、前置闸、丢弃归属校验。
 *
 * 断言只锁外部行为（主树文件内容 / 分支存在性 / 目录存在性 / 结果字段），
 * 不断言 git 命令序列。
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
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

    describe('mergeBack no-ff', () => {
        it('脏 worktree 自动 WIP 提交 → 主树 merge → 清理 worktree/分支；.mobi 不进提交', async () => {
            const worktreePath = await temp.addWorktree('feature')
            await writeFile(join(worktreePath, 'feature.txt'), 'implemented\n')
            await mkdir(join(worktreePath, '.mobi', 'journal'), { recursive: true })
            await writeFile(join(worktreePath, '.mobi', 'journal', 'noise.json'), '{}\n')

            const result = await service.mergeBack({ worktreePath })

            expect(result).toMatchObject({
                ok: true,
                strategy: 'no-ff',
                worktreeRemoved: true,
                branchDeleted: true
            })
            expect(await readFile(join(temp.repo, 'feature.txt'), 'utf8')).toBe('implemented\n')
            const log = await git(temp.repo, ['log', '--format=%s'])
            expect(log).toContain('WIP: mobi feature pre-merge')
            expect(log).toContain("Merge branch 'mobi-feature'")
            const tracked = await git(temp.repo, ['ls-files'])
            expect(tracked).not.toContain('.mobi/journal/noise.json')
            expect(await exists(worktreePath)).toBe(false)
            expect(await branchExists(temp.repo, 'mobi-feature')).toBe(false)
        })

        it('干净 worktree（改动已提交）不产生空 WIP 提交', async () => {
            const worktreePath = await temp.addWorktree('clean')
            await writeFile(join(worktreePath, 'feature.txt'), 'committed\n')
            await git(worktreePath, ['add', '.'])
            await git(worktreePath, ['commit', '-qm', 'feature work'])

            const result = await service.mergeBack({ worktreePath })

            expect(result.ok).toBe(true)
            const log = await git(temp.repo, ['log', '--format=%s'])
            expect(log).not.toContain('WIP: mobi clean pre-merge')
            expect(await readFile(join(temp.repo, 'feature.txt'), 'utf8')).toBe('committed\n')
        })

        it('cleanup=false 时保留 worktree 与分支（内容已合入）', async () => {
            const worktreePath = await temp.addWorktree('keep')
            await writeFile(join(worktreePath, 'keep.txt'), 'x\n')

            const result = await service.mergeBack({ worktreePath, cleanup: false })

            expect(result).toMatchObject({ ok: true, worktreeRemoved: false, branchDeleted: false })
            expect(await exists(worktreePath)).toBe(true)
            expect(await branchExists(temp.repo, 'mobi-keep')).toBe(true)
        })
    })

    describe('mergeBack squash', () => {
        it('压成一条提交且无 merge commit，随后强删分支', async () => {
            const worktreePath = await temp.addWorktree('squash')
            await writeFile(join(worktreePath, 'squash.txt'), 'squashed\n')

            const result = await service.mergeBack({ worktreePath, strategy: 'squash' })

            expect(result).toMatchObject({ ok: true, strategy: 'squash', worktreeRemoved: true, branchDeleted: true })
            expect(await readFile(join(temp.repo, 'squash.txt'), 'utf8')).toBe('squashed\n')
            expect((await git(temp.repo, ['log', '-1', '--format=%s'])).trim()).toBe('mobi worktree squash: squash merge')
            const parents = (await git(temp.repo, ['rev-list', '--parents', '-1', 'HEAD'])).trim().split(/\s+/)
            expect(parents).toHaveLength(2) // 自身 + 单父提交（无第二父）
            expect(await branchExists(temp.repo, 'mobi-squash')).toBe(false)
        })

        it('冲突时主树回滚到合并前（squash 无 MERGE_HEAD 的 reset 路径）', async () => {
            const worktreePath = await temp.addWorktree('squash-conflict')
            await writeFile(join(worktreePath, 'README.md'), 'worktree\n')
            await writeFile(join(temp.repo, 'README.md'), 'main\n')
            await git(temp.repo, ['commit', '-qam', 'main change'])

            const result = await service.mergeBack({ worktreePath, strategy: 'squash' })

            expect(result).toMatchObject({
                ok: false,
                reason: 'merge-failed',
                conflict: true,
                files: ['README.md']
            })
            expect(await readFile(join(temp.repo, 'README.md'), 'utf8')).toBe('main\n')
            expect((await git(temp.repo, ['status', '--porcelain'])).trim()).toBe('')
        })
    })

    describe('mergeBack 前置闸', () => {
        it('主树有未提交改动 → main-dirty 并附文件清单', async () => {
            const worktreePath = await temp.addWorktree('dirty-main')
            await writeFile(join(worktreePath, 'x.txt'), 'x\n')
            await writeFile(join(temp.repo, 'README.md'), 'local edit\n')

            const result = await service.mergeBack({ worktreePath })

            expect(result).toMatchObject({ ok: false, reason: 'main-dirty' })
            if (!result.ok) expect(result.files).toContain('README.md')
            expect(await exists(worktreePath)).toBe(true)
        })

        it('所属会话运行中 → session-running，不动 worktree', async () => {
            const worktreePath = await temp.addWorktree('busy')
            const session = store.addWorktreeSession({ basePath: temp.repo, name: 'busy', worktreePath })
            runningSessionIds.add(session.id)
            await writeFile(join(worktreePath, 'x.txt'), 'x\n')

            expect(await service.mergeBack({ worktreePath })).toEqual({ ok: false, reason: 'session-running' })
            expect(await exists(worktreePath)).toBe(true)
            expect(await branchExists(temp.repo, 'mobi-busy')).toBe(true)
        })

        it('非约定路径 / 非 mobi 分支 → invalid-worktree', async () => {
            expect(await service.mergeBack({ worktreePath: join(temp.dir, 'nope') })).toMatchObject({
                ok: false,
                reason: 'invalid-worktree'
            })
            const foreign = await temp.addRawWorktree('foreign', 'feature/x')
            expect(await service.mergeBack({ worktreePath: foreign })).toMatchObject({
                ok: false,
                reason: 'invalid-worktree'
            })
        })
    })

    describe('mergeBack 冲突', () => {
        it('冲突 → 主树回滚、WIP 提交保留在 worktree 分支、返回冲突清单', async () => {
            const worktreePath = await temp.addWorktree('conflict')
            await writeFile(join(worktreePath, 'README.md'), 'worktree\n')
            await writeFile(join(temp.repo, 'README.md'), 'main\n')
            await git(temp.repo, ['commit', '-qam', 'main change'])

            const result = await service.mergeBack({ worktreePath })

            expect(result).toMatchObject({
                ok: false,
                reason: 'merge-failed',
                conflict: true,
                files: ['README.md']
            })
            expect(await readFile(join(temp.repo, 'README.md'), 'utf8')).toBe('main\n')
            expect((await git(temp.repo, ['status', '--porcelain'])).trim()).toBe('')
            expect(await branchExists(temp.repo, 'mobi-conflict')).toBe(true)
            expect((await git(worktreePath, ['log', '-1', '--format=%s'])).trim()).toBe('WIP: mobi conflict pre-merge')
        })
    })

    describe('discard', () => {
        it('脏 worktree 也连根删除 worktree 与分支', async () => {
            const worktreePath = await temp.addWorktree('trash')
            await writeFile(join(worktreePath, 'uncommitted.txt'), 'bye\n')

            expect(await service.discard({ worktreePath })).toEqual({
                ok: true,
                worktreeRemoved: true,
                branchDeleted: true
            })
            expect(await exists(worktreePath)).toBe(false)
            expect(await branchExists(temp.repo, 'mobi-trash')).toBe(false)
        })

        it('归属约定不符（分支不是 mobi-<name>）→ 拒绝且目录保留', async () => {
            const foreign = await temp.addRawWorktree('evil', 'feature/x')

            expect(await service.discard({ worktreePath: foreign })).toMatchObject({
                ok: false,
                reason: 'invalid-worktree'
            })
            expect(await exists(foreign)).toBe(true)
        })

        it('运行中会话 → 拒绝丢弃', async () => {
            const worktreePath = await temp.addWorktree('busy')
            const session = store.addWorktreeSession({ basePath: temp.repo, name: 'busy', worktreePath })
            runningSessionIds.add(session.id)

            expect(await service.discard({ worktreePath })).toEqual({ ok: false, reason: 'session-running' })
            expect(await exists(worktreePath)).toBe(true)
        })
    })
})
