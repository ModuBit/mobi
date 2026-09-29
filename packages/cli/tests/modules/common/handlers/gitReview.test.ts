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
 * git 审查数据链真仓库集成测试（审查重写 v2 六方法）：临时目录 git init 走真实 git，
 * overview/files/patch/contents/commits/init 逐方法断言 + turn 档 journal 补入 +
 * 路径越界拒绝 + 非 git 目录 journal 供数。快照相关断言背书 02 的存储接口契约。
 */

import { afterAll, beforeAll, describe, it, expect } from 'vitest'
import { execFile } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { GitReviewReader, registerGitReviewHandlers } from '@/modules/common/handlers/gitReview'
import { openTurnSnapshotStore } from '@/modules/common/git/gitTurnSnapshotStore'
import { ReviewContentsResultSchema } from '@mobi/shared'

const execFileAsync = promisify(execFile)

// ── v2 六方法（审查重写）：独立新仓库，避免前序用例的链/工作区状态干扰 ──────────
describe('GitReviewReader v2 六方法（真 git 集成）', () => {
    let v2Dir: string
    let v2NonGit: string
    let v2Session: string

    async function v2git(...args: string[]): Promise<string> {
        const { stdout } = await execFileAsync('git', args, { cwd: v2Dir })
        return stdout
    }

    beforeAll(async () => {
        v2Dir = await mkdtemp(join(tmpdir(), 'mobi-review-v2-'))
        await execFileAsync('git', ['init', '-q'], { cwd: v2Dir })
        await execFileAsync('git', ['config', 'user.email', 'test@mobi.local'], { cwd: v2Dir })
        await execFileAsync('git', ['config', 'user.name', 'mobi-test'], { cwd: v2Dir })
        await writeFile(join(v2Dir, 'init.txt'), 'init\n')
        await execFileAsync('git', ['add', '-A'], { cwd: v2Dir })
        await execFileAsync('git', ['commit', '-qm', 'init commit'], { cwd: v2Dir })
        // 第二个提交：commit 档与 commits 分页的事实源
        await writeFile(join(v2Dir, 'second.txt'), 'second\n')
        await execFileAsync('git', ['add', '-A'], { cwd: v2Dir })
        await execFileAsync('git', ['commit', '-qm', 'second commit'], { cwd: v2Dir })
        v2Session = 'v2-session'
    })

    afterAll(async () => {
        await rm(v2Dir, { recursive: true, force: true })
        if (v2NonGit) await rm(v2NonGit, { recursive: true, force: true })
    })

    it('路径越界被拒（绝对路径 / .. 逃逸）', async () => {
        const reader = new GitReviewReader(v2Dir)
        const target = { kind: 'worktree', area: 'unstaged' } as const
        await expect(reader.patch('s', target, '../../../etc/passwd', null)).rejects.toThrow(/Invalid path/)
        await expect(reader.patch('s', target, '/etc/passwd', null)).rejects.toThrow(/Invalid path/)
        await expect(reader.contents('s', target, '../escape', null)).rejects.toThrow(/Invalid path/)
    })

    it('overview：五档可用性 + 各档统计 + targetGeneration；commit 档有 HEAD 即可用', async () => {
        const { ReviewOverviewSchema, DiffTargetSchema } = await import('@mobi/shared')
        const reader = new GitReviewReader(v2Dir)
        const store = (await openTurnSnapshotStore(v2Dir))!
        const overview = ReviewOverviewSchema.parse(await reader.overview(v2Session, store))
        expect(overview.isGitRepository).toBe(true)
        expect(overview.unavailableScopes).toEqual({ turn: false, uncommitted: false, unstaged: false, staged: false, commit: false })
        expect(overview.scopes.turn).toEqual({ fileCount: 0, additions: 0, deletions: 0 })
        expect(overview.scopes.uncommitted).toEqual({ fileCount: 0, additions: 0, deletions: 0 })
        const generationBefore = overview.targetGeneration

        // 工作区改动后 uncommitted 统计推进、版本推进
        await writeFile(join(v2Dir, 'init.txt'), 'init\nchanged\n')
        const after = ReviewOverviewSchema.parse(await reader.overview(v2Session, store))
        expect(after.scopes.uncommitted).toEqual({ fileCount: 1, additions: 1, deletions: 0 })
        expect(after.targetGeneration).toBeGreaterThan(generationBefore)
        void DiffTargetSchema
    })

    it('files + patch + contents：worktree uncommitted 档全链路', async () => {
        const { ReviewFilesResultSchema, ReviewPatchResultSchema, ReviewContentsResultSchema } = await import('@mobi/shared')
        const reader = new GitReviewReader(v2Dir)
        const store = (await openTurnSnapshotStore(v2Dir))!
        const target = { kind: 'worktree', area: 'uncommitted' } as const
        const files = ReviewFilesResultSchema.parse(await reader.files(v2Session, target, store))
        expect(files.files.map((f) => f.path)).toEqual(['init.txt'])
        expect(files.files[0]).toMatchObject({ kind: 'modify', additions: 1, deletions: 0, binary: false, untracked: false })
        expect(files.targetGeneration).toBeGreaterThan(0)

        const patch = ReviewPatchResultSchema.parse(await reader.patch(v2Session, target, 'init.txt', null))
        expect(patch.patch).toContain('+changed')
        expect(patch.binary).toBe(false)

        const contents = ReviewContentsResultSchema.parse(await reader.contents(v2Session, target, 'init.txt', null))
        expect(contents.before).toBe('init\n')
        expect(contents.after).toBe('init\nchanged\n')
        expect(contents.reason).toBeNull()
    })

    it('commit 档：files/diff/contents 钉在历史提交对；commits 分页', async () => {
        const { ReviewFilesResultSchema, ReviewPatchResultSchema, ReviewCommitsResultSchema } = await import('@mobi/shared')
        const reader = new GitReviewReader(v2Dir)
        const log = await v2git('log', '--format=%H %P', '-n2')
        const [headSha, headParent] = log.split('\n')[0]!.split(' ')
        void headParent
        const target = { kind: 'commit', range: { base: headSha + '^', head: headSha } } as const

        const files = ReviewFilesResultSchema.parse(await reader.files(v2Session, target, null))
        expect(files.files.map((f) => f.path)).toEqual(['second.txt'])
        const patch = ReviewPatchResultSchema.parse(await reader.patch(v2Session, target, 'second.txt', null))
        expect(patch.patch).toContain('+second')
        const contents = ReviewContentsResultSchema.parse(await reader.contents(v2Session, target, 'second.txt', null))
        expect(contents.before).toBeNull()
        expect(contents.after).toBe('second\n')

        // commits 分页：页长 50，单仓库两提交 → 一页到底
        const page = ReviewCommitsResultSchema.parse(await reader.commits())
        expect(page.commits).toHaveLength(2)
        expect(page.commits[0]).toMatchObject({ subject: 'second commit', parentSha: expect.not.stringContaining(' ') })
        expect(page.nextCursor).toBeNull()
    })

    it('turn 档 journal 补入：gitignored 文件进 turn 清单，git 条目不重复', async () => {
        const { ReviewFilesResultSchema } = await import('@mobi/shared')
        const { PersistentToolChangeJournal, getToolChangesPath } = await import('@/modules/common/git/toolChangeJournal')
        await writeFile(join(v2Dir, '.gitignore'), 'secret.local\n')
        // 快照（.gitignore 已生效，secret.local 不进树）
        const store = (await openTurnSnapshotStore(v2Dir))!
        await store.capture(v2Session)
        await writeFile(join(v2Dir, 'tracked.txt'), 'tracked new\n')
        await store.capture(v2Session)

        // journal 记录 gitignored 文件 + 一个 tracked 文件（应去重，git 视角为准）
        const journalPath = getToolChangesPath(v2Dir, v2Session)
        const journal = await PersistentToolChangeJournal.open(journalPath)
        journal.record({ path: 'secret.local', beforeContent: null, afterContent: 'hush\n', toolName: 'Write' })
        journal.record({ path: 'tracked.txt', beforeContent: null, afterContent: 'stale\n', toolName: 'Write' })
        await journal.flush()

        const files = ReviewFilesResultSchema.parse(await new GitReviewReader(v2Dir).files(v2Session, { kind: 'turn' }, store))
        const paths = files.files.map((f) => f.path)
        expect(paths).toContain('tracked.txt')
        expect(paths).toContain('secret.local')
        expect(paths.filter((p) => p === 'tracked.txt')).toHaveLength(1)
        const secret = files.files.find((f) => f.path === 'secret.local')!
        expect(secret).toMatchObject({ kind: 'add', untracked: true })
        await rm(journalPath, { force: true })
    })

    it('非 git 目录：overview turn 非 null（journal 供数）、git 系全不可用；files(turn) 走 journal', async () => {
        const { ReviewOverviewSchema, ReviewFilesResultSchema } = await import('@mobi/shared')
        const { PersistentToolChangeJournal, getToolChangesPath } = await import('@/modules/common/git/toolChangeJournal')
        v2NonGit = await mkdtemp(join(tmpdir(), 'mobi-review-v2-nongit-'))
        const sid = 'nongit-session'
        const journal = await PersistentToolChangeJournal.open(getToolChangesPath(v2NonGit, sid))
        journal.record({ path: 'app.ts', beforeContent: 'a\n', afterContent: 'a\nb\n', toolName: 'Edit' })
        await journal.flush()

        const reader = new GitReviewReader(v2NonGit)
        const overview = ReviewOverviewSchema.parse(await reader.overview(sid, null))
        expect(overview.isGitRepository).toBe(false)
        expect(overview.unavailableScopes).toEqual({ turn: false, uncommitted: true, unstaged: true, staged: true, commit: true })
        expect(overview.scopes.turn).toEqual({ fileCount: 1, additions: 1, deletions: 0 })

        const files = ReviewFilesResultSchema.parse(await reader.files(sid, { kind: 'turn' }, null))
        expect(files.files).toHaveLength(1)
        expect(files.files[0]).toMatchObject({ path: 'app.ts', kind: 'modify', additions: 1 })
        // git 系档位拒绝
        await expect(reader.files(sid, { kind: 'worktree', area: 'unstaged' }, null)).rejects.toThrow(/git repository/)
        // contents 从 journal 出全文对
        const contents = ReviewContentsResultSchema.parse(await reader.contents(sid, { kind: 'turn' }, 'app.ts', null))
        expect(contents.before).toBe('a\n')
        expect(contents.after).toBe('a\nb\n')
        await rm(getToolChangesPath(v2NonGit, sid), { force: true })
    })

    it('init：非 git 目录一键 init 后五档上线（缓存失效生效）', async () => {
        const { ReviewOverviewSchema } = await import('@mobi/shared')
        const initDir = await mkdtemp(join(tmpdir(), 'mobi-review-init-'))
        try {
            const reader = new GitReviewReader(initDir)
            const before = ReviewOverviewSchema.parse(await reader.overview('s', await openTurnSnapshotStore(initDir)))
            expect(before.isGitRepository).toBe(false)

            const result = await reader.initRepo() as { success: boolean; error: string | null }
            expect(result.success).toBe(true)

            // reader 自身缓存已失效（repoRoot 置空）；store 缓存也失效 → 重新打开非 null
            const store = await openTurnSnapshotStore(initDir)
            expect(store).not.toBeNull()
            const after = ReviewOverviewSchema.parse(await reader.overview('s', store))
            expect(after.isGitRepository).toBe(true)
            expect(after.unavailableScopes.turn).toBe(false)
        } finally {
            await rm(initDir, { recursive: true, force: true })
        }
    })

    it('RPC 注册：v2 六方法可经 handler map 直调', async () => {
        const handlers = new Map<string, (params: never) => Promise<unknown>>()
        registerGitReviewHandlers({
            registerHandler: (method, handler) => handlers.set(method, handler as never),
        } as never)
        for (const method of ['gitReviewOverview', 'gitReviewFiles', 'gitReviewDiff', 'gitReviewContents', 'gitReviewCommits', 'gitReviewInit']) {
            expect(handlers.has(method)).toBe(true)
        }
        const overview = await handlers.get('gitReviewOverview')!({ cwd: v2Dir, sessionId: v2Session } as never) as { isGitRepository: boolean }
        expect(overview.isGitRepository).toBe(true)
        const commits = await handlers.get('gitReviewCommits')!({ cwd: v2Dir } as never) as { commits: unknown[] }
        expect(commits.commits.length).toBeGreaterThan(0)
    })
})
