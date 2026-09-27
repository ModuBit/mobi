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
 * git 审查数据链真仓库集成测试（turn-diff 票04）：临时目录 git init 走真实 git，
 * 四档 scope 逐档断言 + untracked no-index 兜底 + 单文件 diff 三件套 + 路径越界拒绝 +
 * 非 git 目录 unavailable。快照相关断言背书 02 的存储接口契约。
 */

import { afterAll, beforeAll, describe, it, expect } from 'vitest'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { GitReviewReader, registerGitReviewHandlers } from '@/modules/common/handlers/gitReview'
import { openTurnSnapshotStore } from '@/modules/common/git/gitTurnSnapshotStore'
import { GitReviewDataSchema, GitReviewFileDiffSchema } from '@mobi/shared'

const execFileAsync = promisify(execFile)

const SESSION_ID = 'test-session'

let repoDir: string
let nonGitDir: string
let store: NonNullable<Awaited<ReturnType<typeof openTurnSnapshotStore>>>

async function git(...args: string[]): Promise<string> {
    const { stdout } = await execFileAsync('git', args, { cwd: repoDir })
    return stdout
}

async function write(relPath: string, content: string): Promise<void> {
    const full = join(repoDir, relPath)
    await mkdir(join(full, '..'), { recursive: true })
    await writeFile(full, content)
}

beforeAll(async () => {
    repoDir = await mkdtemp(join(tmpdir(), 'mobi-git-review-'))
    await git('init', '-q')
    await git('config', 'user.email', 'test@mobi.local')
    await git('config', 'user.name', 'mobi-test')
    await write('README.md', '# t\n')
    await write('a.txt', 'one\n')
    await write('b.txt', 'orig\n')
    await git('add', '-A')
    await git('commit', '-qm', 'init')
    store = (await openTurnSnapshotStore(repoDir))!
})

afterAll(async () => {
    await rm(repoDir, { recursive: true, force: true })
    await rm(nonGitDir, { recursive: true, force: true })
})

describe('GitReviewReader（真 git 集成）', () => {
    it('四档一次拉：已暂存=--cached、未暂存=工作区+untracked、未提交=两集合并、上一轮=两快照 diff', async () => {
        // 状态设计：
        //   a.txt 已暂存修改（staged 有、unstaged 无）
        //   b.txt 工作区已跟踪修改（unstaged 有）
        //   new.txt untracked（unstaged 有，no-index 计数）
        await write('a.txt', 'one\ntwo\n')
        await git('add', 'a.txt')
        await write('b.txt', 'x\n')
        await write('new.txt', 'hello\nworld\n')
        // 快照 1（以当时工作区为界），再改出快照 2——last-turn = 两树差异
        await store.capture(SESSION_ID)
        await write('a.txt', 'one\ntwo\nthree\n')
        await write('moved-into-turn.txt', 'added this turn\n')
        const snap2 = await store.capture(SESSION_ID)

        const data = GitReviewDataSchema.parse(await new GitReviewReader(repoDir).reviewData(SESSION_ID, store))
        expect(data.unavailable).toBe(false)

        // 已暂存：只有 a.txt（暂存后未再动它）
        expect(data.scopes.staged.files.map((f) => f.path)).toEqual(['a.txt'])
        expect(data.scopes.staged.files[0]).toMatchObject({ kind: 'modify', additions: 1, deletions: 0 })
        expect(data.scopes.staged.git).toBeNull()

        // 未暂存：b.txt（已跟踪修改）+ new.txt（untracked，no-index 数出 +2）
        const unstagedPaths = data.scopes.unstaged.files.map((f) => f.path)
        expect(unstagedPaths).toContain('b.txt')
        expect(unstagedPaths).toContain('new.txt')
        expect(data.scopes.unstaged.files.find((f) => f.path === 'new.txt')).toMatchObject({ kind: 'add', additions: 2, deletions: 0 })

        // 未提交：staged ∪ unstaged 合并，且 stats 单源自 summarize
        const uncommittedPaths = data.scopes.uncommitted.files.map((f) => f.path)
        expect(uncommittedPaths).toEqual(expect.arrayContaining(['a.txt', 'b.txt', 'new.txt']))
        expect(data.scopes.uncommitted.stats.files).toBe(data.scopes.uncommitted.files.length)

        // 上一轮：两快照 diff——a.txt 修改 + moved-into-turn.txt 新增，两树指针随档返回
        expect(data.scopes['last-turn']).not.toBeNull()
        const lastTurn = data.scopes['last-turn']!
        expect(lastTurn.git!.headTree).toBe(snap2.tree)
        expect(lastTurn.files.find((f) => f.path === 'a.txt')).toMatchObject({ kind: 'modify' })
        expect(lastTurn.files.find((f) => f.path === 'moved-into-turn.txt')).toMatchObject({ kind: 'add' })
    })

    it('单文件 diff 三件套：四档 before/after 全文与 patch 均正确', async () => {
        const data = GitReviewDataSchema.parse(await new GitReviewReader(repoDir).reviewData(SESSION_ID, store))
        const reader = new GitReviewReader(repoDir)

        // 已暂存档：before = HEAD 内容，after = index 内容
        const staged = GitReviewFileDiffSchema.parse(await reader.fileDiff({ scope: 'staged', path: 'a.txt' }))
        expect(staged.before).toBe('one\n')
        expect(staged.after).toBe('one\ntwo\n')
        expect(staged.patch).toContain('+two')

        // 未暂存档（已跟踪）：before = index 内容，after = 盘上内容
        const unstaged = GitReviewFileDiffSchema.parse(await reader.fileDiff({ scope: 'unstaged', path: 'b.txt' }))
        expect(unstaged.before).toBe('orig\n')
        expect(unstaged.after).toBe('x\n')

        // untracked 经未暂存档：before = null（index 无此路径），patch 走 no-index
        const untracked = GitReviewFileDiffSchema.parse(await reader.fileDiff({ scope: 'unstaged', path: 'new.txt' }))
        expect(untracked.before).toBeNull()
        expect(untracked.after).toBe('hello\nworld\n')
        expect(untracked.patch).toContain('+hello')

        // 未提交档（untracked 新文件）：HEAD 无此路径，no-index 兜底出 patch
        const uncommitted = GitReviewFileDiffSchema.parse(await reader.fileDiff({ scope: 'uncommitted', path: 'new.txt' }))
        expect(uncommitted.before).toBeNull()
        expect(uncommitted.patch).toContain('+hello')

        // 上一轮档：两树指针回查
        const lastTurn = data.scopes['last-turn']!
        const lt = GitReviewFileDiffSchema.parse(await reader.fileDiff({
            scope: 'last-turn', path: 'a.txt', baseTree: lastTurn.git!.baseTree, headTree: lastTurn.git!.headTree,
        }))
        expect(lt.before).toBe('one\ntwo\n')
        expect(lt.after).toBe('one\ntwo\nthree\n')
    })

    it('路径越界被拒（绝对路径 / .. 逃逸）', async () => {
        const reader = new GitReviewReader(repoDir)
        await expect(reader.fileDiff({ scope: 'unstaged', path: '../../../etc/passwd' })).rejects.toThrow(/Invalid path/)
        await expect(reader.fileDiff({ scope: 'staged', path: '/etc/passwd' })).rejects.toThrow(/Invalid path/)
    })

    it('非 git 目录：unavailable 总开关，四档空', async () => {
        nonGitDir = await mkdtemp(join(tmpdir(), 'mobi-git-review-nongit-'))
        const data = GitReviewDataSchema.parse(await new GitReviewReader(nonGitDir).reviewData('s', null))
        expect(data.unavailable).toBe(true)
        expect(data.scopes['last-turn']).toBeNull()
        expect(data.scopes.uncommitted.files).toEqual([])
        expect(data.scopes.staged.files).toEqual([])
    })

    it('RPC 注册：handler 可直调，失败路径回 rpcError 语义', async () => {
        const handlers = new Map<string, (params: never) => Promise<unknown>>()
        registerGitReviewHandlers({
            registerHandler: (method, handler) => handlers.set(method, handler as never),
        } as never)

        // data handler（以真仓库 cwd 调通）
        const data = GitReviewDataSchema.parse(await handlers.get('gitReviewData')!({
            cwd: repoDir, sessionId: SESSION_ID,
        } as never))
        expect(data.unavailable).toBe(false)

        // file handler：越界路径 → 结构化错误（不抛，走 rpcError 返回）
        const err = await handlers.get('gitReviewFile')!({
            cwd: repoDir, query: { scope: 'unstaged', path: '../escape' },
        } as never) as { success: false; error: string }
        expect(err.success).toBe(false)
        expect(err.error).toBeTruthy()
    })
})
