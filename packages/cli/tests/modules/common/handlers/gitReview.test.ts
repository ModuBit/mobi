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
import { getTurnArchivePath } from '@/modules/common/git/turnArchiveStore'
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
        const overview = ReviewOverviewSchema.parse(await reader.overview(v2Session))
        expect(overview.isGitRepository).toBe(true)
        expect(overview.unavailableScopes).toEqual({ turn: false, uncommitted: false, unstaged: false, staged: false, commit: false })
        expect(overview.scopes.turn).toEqual({ fileCount: 0, additions: 0, deletions: 0 })
        expect(overview.scopes.uncommitted).toEqual({ fileCount: 0, additions: 0, deletions: 0 })
        const generationBefore = overview.targetGeneration

        // 工作区改动后 uncommitted 统计推进、版本推进（dirty 刻度）
        await writeFile(join(v2Dir, 'init.txt'), 'init\nchanged\n')
        const after = ReviewOverviewSchema.parse(await reader.overview(v2Session))
        expect(after.scopes.uncommitted).toEqual({ fileCount: 1, additions: 1, deletions: 0 })
        expect(after.targetGeneration).toBeGreaterThan(generationBefore)
        void DiffTargetSchema
    })

    it('files + patch + contents：worktree uncommitted 档全链路', async () => {
        const { ReviewFilesResultSchema, ReviewPatchResultSchema, ReviewContentsResultSchema } = await import('@mobi/shared')
        const reader = new GitReviewReader(v2Dir)
        const target = { kind: 'worktree', area: 'uncommitted' } as const
        const files = ReviewFilesResultSchema.parse(await reader.files(v2Session, target))
        expect(files.files.map((f) => f.path)).toEqual(['init.txt'])
        expect(files.files[0]).toMatchObject({ kind: 'modify', additions: 1, deletions: 0, binary: false, untracked: false })
        expect(files.targetGeneration).toBeGreaterThan(0)

        const patch = ReviewPatchResultSchema.parse(await reader.patch(v2Session, target, 'init.txt'))
        expect(patch.patch).toContain('+changed')
        expect(patch.binary).toBe(false)

        const contents = ReviewContentsResultSchema.parse(await reader.contents(v2Session, target, 'init.txt'))
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

        const files = ReviewFilesResultSchema.parse(await reader.files(v2Session, target))
        expect(files.files.map((f) => f.path)).toEqual(['second.txt'])
        const patch = ReviewPatchResultSchema.parse(await reader.patch(v2Session, target, 'second.txt'))
        expect(patch.patch).toContain('+second')
        const contents = ReviewContentsResultSchema.parse(await reader.contents(v2Session, target, 'second.txt'))
        expect(contents.before).toBeNull()
        expect(contents.after).toBe('second\n')

        // commits 分页：页长 50，单仓库两提交 → 一页到底
        const page = ReviewCommitsResultSchema.parse(await reader.commits())
        expect(page.commits).toHaveLength(2)
        expect(page.commits[0]).toMatchObject({ subject: 'second commit', parentSha: expect.not.stringContaining(' ') })
        expect(page.nextCursor).toBeNull()
    })

    it('非 git 目录：turn 档归档供数（无归档 = 空），git 系全不可用；contents(turn) 空降级', async () => {
        const { ReviewOverviewSchema, ReviewFilesResultSchema, ReviewPatchResultSchema } = await import('@mobi/shared')
        v2NonGit = await mkdtemp(join(tmpdir(), 'mobi-review-v2-nongit-'))
        const sid = 'nongit-session'
        const { FileTurnArchiveStore, getTurnArchivePath } = await import('@/modules/common/git/turnArchiveStore')
        const archive = new FileTurnArchiveStore(getTurnArchivePath(v2NonGit, sid))
        await archive.seal({
            turnIndex: 1,
            baseTurnIndex: null,
            sealedAt: Date.now(),
            files: [{ path: 'app.ts', kind: 'modify', additions: 1, deletions: 0, writeCount: 1, toolNames: ['Edit'], patch: '--- a/app.ts\n+++ b/app.ts\n@@ -1 +1,2 @@\n a\n+b\n', oversizedPatch: false }],
        })

        const reader = new GitReviewReader(v2NonGit)
        const overview = ReviewOverviewSchema.parse(await reader.overview(sid))
        expect(overview.isGitRepository).toBe(false)
        expect(overview.unavailableScopes).toEqual({ turn: false, uncommitted: true, unstaged: true, staged: true, commit: true })
        expect(overview.scopes.turn).toEqual({ fileCount: 1, additions: 1, deletions: 0 })

        const files = ReviewFilesResultSchema.parse(await reader.files(sid, { kind: 'turn' }))
        expect(files.files).toHaveLength(1)
        expect(files.files[0]).toMatchObject({ path: 'app.ts', kind: 'modify', additions: 1 })
        // git 系档位拒绝
        await expect(reader.files(sid, { kind: 'worktree', area: 'unstaged' })).rejects.toThrow(/git repository/)
        // patch 直读归档封口定稿
        const patch = ReviewPatchResultSchema.parse(await reader.patch(sid, { kind: 'turn' }, 'app.ts'))
        expect(patch.patch).toContain('+b')
        // contents 空降级（归档无全文）
        const contents = ReviewContentsResultSchema.parse(await reader.contents(sid, { kind: 'turn' }, 'app.ts'))
        expect(contents).toMatchObject({ before: null, after: null, reason: 'missing' })
        await rm(getTurnArchivePath(v2NonGit, sid), { force: true })
    })

    it('init：非 git 目录一键 init 后五档上线（缓存失效生效）', async () => {
        const { ReviewOverviewSchema } = await import('@mobi/shared')
        const initDir = await mkdtemp(join(tmpdir(), 'mobi-review-init-'))
        try {
            const reader = new GitReviewReader(initDir)
            const before = ReviewOverviewSchema.parse(await reader.overview('s'))
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

// ── turn-archive B：turn 档读侧收口（patch 直读归档 + contents 空降级 + generation 新公式）──
describe('GitReviewReader turn 档（归档直读，真 git 集成）', () => {
    let v3Dir: string
    const sid = 'v3-session'

    beforeAll(async () => {
        v3Dir = await mkdtemp(join(tmpdir(), 'mobi-review-v3-'))
        await execFileAsync('git', ['init', '-q'], { cwd: v3Dir })
        await execFileAsync('git', ['config', 'user.email', 'test@mobi.local'], { cwd: v3Dir })
        await execFileAsync('git', ['config', 'user.name', 'mobi-test'], { cwd: v3Dir })
        await writeFile(join(v3Dir, 'base.txt'), 'base\n')
        await execFileAsync('git', ['add', '-A'], { cwd: v3Dir })
        await execFileAsync('git', ['commit', '-qm', 'init'], { cwd: v3Dir })
        // 封口归档（B 形状）：turn 7 改 a.ts——工作区另有 b.ts 改动（模拟并发/手改，归档必须无视）
        const { FileTurnArchiveStore, getTurnArchivePath } = await import('@/modules/common/git/turnArchiveStore')
        const archive = new FileTurnArchiveStore(getTurnArchivePath(v3Dir, sid))
        await archive.seal({
            turnIndex: 7,
            baseTurnIndex: 6,
            sealedAt: 1_700_000_012_345,
            files: [{ path: join(v3Dir, 'a.ts'), kind: 'modify', additions: 1, deletions: 0, writeCount: 1, toolNames: ['Edit'], patch: '--- a/a.ts\n+++ b/a.ts\n@@ -1 +1,2 @@\n one\n+two\n', oversizedPatch: false }],
        })
        // 工作区实况：b.ts 被改（未提交档视角）
        await writeFile(join(v3Dir, 'b.ts'), 'b changed\n')
        await writeFile(join(v3Dir, 'a.ts'), 'one\ntwo\n')
    })

    afterAll(async () => {
        await rm(getTurnArchivePath(v3Dir, sid), { force: true })
        await rm(v3Dir, { recursive: true, force: true })
    })

    it('overview turn 档 = 最新封口轮（归因），不含工作区其他改动', async () => {
        const { ReviewOverviewSchema } = await import('@mobi/shared')
        const reader = new GitReviewReader(v3Dir)
        const overview = ReviewOverviewSchema.parse(await reader.overview(sid))
        // 封口档只有 a.ts +1；b.ts 的工作区改动属于 uncommitted 档
        expect(overview.scopes.turn).toEqual({ fileCount: 1, additions: 1, deletions: 0 })
        expect(overview.scopes.uncommitted!.fileCount).toBeGreaterThanOrEqual(1)
    })

    it('generation 新公式：floor(sealedAt/10)*10000 + dirty——封口换代、dirty 变化换代', async () => {
        const { ReviewOverviewSchema } = await import('@mobi/shared')
        const reader = new GitReviewReader(v3Dir)
        const base = ReviewOverviewSchema.parse(await reader.overview(sid)).targetGeneration
        // 封口刻度：floor(1700000012345/10)*10000 = 170000001234*10000
        expect(base).toBe(170000001234 * 10000 + 2) // dirty = a.ts(untracked) + b.ts(modified)；.mobi 不计
        // dirty 变化（新增一条 status 记录）→ 换代
        await writeFile(join(v3Dir, 'c.ts'), 'new\n')
        const after = ReviewOverviewSchema.parse(await reader.overview(sid)).targetGeneration
        expect(after).toBe(base + 1)
    })

    it('files(turn)：归档条目供数；带 turnIndex 查最新轮；历史/越界轮 not found', async () => {
        const { ReviewFilesResultSchema } = await import('@mobi/shared')
        const reader = new GitReviewReader(v3Dir)
        const files = ReviewFilesResultSchema.parse(await reader.files(sid, { kind: 'turn' }))
        expect(files.files.map((f) => f.path)).toEqual([join(v3Dir, 'a.ts')])
        expect(files.files[0]).toMatchObject({ kind: 'modify', additions: 1, deletions: 0 })

        const latest = ReviewFilesResultSchema.parse(await reader.files(sid, { kind: 'turn', turnIndex: 7 }))
        expect(latest.files).toHaveLength(1)
        // 滚动单条：历史轮不可查
        await expect(reader.files(sid, { kind: 'turn', turnIndex: 1 })).rejects.toThrow(/not found/)
        await expect(reader.files(sid, { kind: 'turn', turnIndex: 99 })).rejects.toThrow(/not found/)
    })

    it('patch(turn) 直读归档封口定稿；contents 空降级；未记录路径空 patch；路径闸保持', async () => {
        const { ReviewPatchResultSchema, ReviewContentsResultSchema } = await import('@mobi/shared')
        const reader = new GitReviewReader(v3Dir)
        const target = { kind: 'turn' } as const

        // patch 直读归档（不再查询时用全文对现合成——归档里没有全文可合成）
        const patch = ReviewPatchResultSchema.parse(await reader.patch(sid, target, join(v3Dir, 'a.ts')))
        expect(patch.patch).toContain('+two')
        expect(patch.oversized).toBe(false)

        // contents 空降级（归档无全文，B 方案能力代价）
        const contents = ReviewContentsResultSchema.parse(await reader.contents(sid, target, join(v3Dir, 'a.ts')))
        expect(contents).toMatchObject({ before: null, after: null, reason: 'missing' })

        // 归档未记录的路径：空 patch / missing
        const empty = ReviewPatchResultSchema.parse(await reader.patch(sid, target, join(v3Dir, 'b.ts')))
        expect(empty.patch).toBe('')
        const missing = ReviewContentsResultSchema.parse(await reader.contents(sid, target, join(v3Dir, 'b.ts')))
        expect(missing).toMatchObject({ before: null, after: null, reason: 'missing' })

        // 路径闸：cwd 外拒绝
        await expect(reader.patch(sid, target, '/etc/passwd')).rejects.toThrow(/Invalid path/)
    })
})
