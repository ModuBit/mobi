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
import { GitReviewDataSchema, GitReviewFileDiffSchema, ReviewContentsResultSchema } from '@mobi/shared'

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
    if (nonGitDir) await rm(nonGitDir, { recursive: true, force: true })
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
        const staged = GitReviewFileDiffSchema.parse(await reader.fileDiff({ scope: 'staged', path: 'a.txt' }, null, ''))
        expect(staged.before).toBe('one\n')
        expect(staged.after).toBe('one\ntwo\n')
        expect(staged.patch).toContain('+two')

        // 未暂存档（已跟踪）：before = index 内容，after = 盘上内容
        const unstaged = GitReviewFileDiffSchema.parse(await reader.fileDiff({ scope: 'unstaged', path: 'b.txt' }, null, ''))
        expect(unstaged.before).toBe('orig\n')
        expect(unstaged.after).toBe('x\n')

        // untracked 经未暂存档：before = null（index 无此路径），patch 走 no-index
        const untracked = GitReviewFileDiffSchema.parse(await reader.fileDiff({ scope: 'unstaged', path: 'new.txt' }, null, ''))
        expect(untracked.before).toBeNull()
        expect(untracked.after).toBe('hello\nworld\n')
        expect(untracked.patch).toContain('+hello')

        // 未提交档（untracked 新文件）：HEAD 无此路径，no-index 兜底出 patch
        const uncommitted = GitReviewFileDiffSchema.parse(await reader.fileDiff({ scope: 'uncommitted', path: 'new.txt' }, null, ''))
        expect(uncommitted.before).toBeNull()
        expect(uncommitted.patch).toContain('+hello')

        // 上一轮档：两树指针回查
        const lastTurn = data.scopes['last-turn']!
        const lt = GitReviewFileDiffSchema.parse(await reader.fileDiff({ scope: 'last-turn', path: 'a.txt' }, store, SESSION_ID))
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
            cwd: repoDir, sessionId: SESSION_ID, query: { scope: 'unstaged', path: '../escape' },
        } as never) as { success: false; error: string }
        expect(err.success).toBe(false)
        expect(err.error).toBeTruthy()
    })

    it('重命名（票07）：上一轮档 rename 条目带旧路径，diff before 取基线旧路径内容', async () => {
        const reader = new GitReviewReader(repoDir)
        // 快照不进 index（临时 index），git mv 需要文件被跟踪——先 commit 再改名
        await write('before-rename.txt', 'rename me\n')
        await git('add', 'before-rename.txt')
        await git('commit', '-qm', 'add before-rename')
        await store.capture(SESSION_ID)
        await git('mv', 'before-rename.txt', 'after-rename.txt')
        await store.capture(SESSION_ID)

        const data = GitReviewDataSchema.parse(await reader.reviewData(SESSION_ID, store))
        const entry = data.scopes['last-turn']!.files.find((f) => f.path === 'after-rename.txt')
        expect(entry).toMatchObject({ kind: 'rename', previousPath: 'before-rename.txt' })

        // 指针与 previousPath 都不进协议：CLI 从链尾 diff 条目自解析
        const diff = GitReviewFileDiffSchema.parse(await reader.fileDiff({ scope: 'last-turn', path: 'after-rename.txt' }, store, SESSION_ID))
        expect(diff.before).toBe('rename me\n')
        expect(diff.after).toBe('rename me\n')
        expect(diff.patch).toContain('rename from before-rename.txt')
    })

    it('空轮（链足两颗但零差异）：last-turn 照实返回空清单——不折叠为 null（「无快照链」是另一种空态）', async () => {
        // 与前序快照零差异的两颗新快照：tail 两树相同 → files []
        const emptyBase = await store.capture(SESSION_ID)
        const emptyHead = await store.capture(SESSION_ID)
        expect(emptyHead.index).toBe(emptyBase.index + 1)

        const data = GitReviewDataSchema.parse(await new GitReviewReader(repoDir).reviewData(SESSION_ID, store))
        const lastTurn = data.scopes['last-turn']!
        expect(lastTurn).not.toBeNull()
        expect(lastTurn.files).toEqual([])
        expect(lastTurn.git!.turnIndex).toBe(emptyHead.index)
    })

    it('last-turn 单文件 diff 带 turnIndex：按链上该序号钉树，后续快照不入 before/after', async () => {
        // 链尾已远超 snap2（后续测试又捕获过），但 turnIndex=2 钉住「a.txt 改动那轮」
        const reader = new GitReviewReader(repoDir)
        const pinned = GitReviewFileDiffSchema.parse(
            await reader.fileDiff({ scope: 'last-turn', path: 'a.txt', turnIndex: 2 }, store, SESSION_ID),
        )
        expect(pinned.before).toBe('one\ntwo\n')
        expect(pinned.after).toBe('one\ntwo\nthree\n')

        // 缺省（不传 turnIndex）保持链尾语义：a.txt 在后续快照中无变化 → before = after
        const tail = GitReviewFileDiffSchema.parse(
            await reader.fileDiff({ scope: 'last-turn', path: 'a.txt' }, store, SESSION_ID),
        )
        expect(tail.before).toBe(tail.after)
    })

    it('clearTurnSnapshots handler：清空该会话的快照引用（for-each-ref 为空）', async () => {
        const handlers = new Map<string, (params: never) => Promise<unknown>>()
        registerGitReviewHandlers({
            registerHandler: (method, handler) => handlers.set(method, handler as never),
        } as never)

        // 会话已有快照（前面用例捕获过）→ 清理 → 链为空
        await store.capture(SESSION_ID)
        const result = await handlers.get('clearTurnSnapshots')!({ cwd: repoDir, sessionId: SESSION_ID } as never) as { success: boolean; cleared: number }
        expect(result.success).toBe(true)
        expect(result.cleared).toBeGreaterThan(0)
        const chain = await store.listChain(SESSION_ID)
        expect(chain).toHaveLength(0)
    })

    it('非文本兜底（双闸）：untracked 二进制 binary 标记正确；fileDiff 全文不吐二进制/超大内容', async () => {
        // untracked 二进制：no-index numstat 的 add/del 列为 `- -`（路径列两段拼接），
        // 条目须正确标 binary:true 且计数为 0
        await writeFile(join(repoDir, 'logo.bin'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0d, 0x0a]))
        const data = GitReviewDataSchema.parse(await new GitReviewReader(repoDir).reviewData(SESSION_ID, store))
        const entry = data.scopes.unstaged.files.find((f) => f.path === 'logo.bin')
        expect(entry).toMatchObject({ kind: 'add', binary: true, additions: 0, deletions: 0 })

        // 全文兜底闸：含 NUL → before/after 均为 null（不进全文通道），patch 不带内容
        const binDiff = GitReviewFileDiffSchema.parse(await new GitReviewReader(repoDir).fileDiff({ scope: 'unstaged', path: 'logo.bin' }))
        expect(binDiff.before).toBeNull()
        expect(binDiff.after).toBeNull()
        expect(binDiff.patch).not.toContain('PNG')

        // 全文兜底闸：超过 MAX_TEXT_BYTES 的文本 → after 置 null
        await write('huge.txt', `${'x'.repeat(4 * 1024 * 1024 + 1)}\n`)
        const hugeDiff = GitReviewFileDiffSchema.parse(await new GitReviewReader(repoDir).fileDiff({ scope: 'unstaged', path: 'huge.txt' }))
        expect(hugeDiff.after).toBeNull()

        // 对照：小文本不受闸影响
        const txtDiff = GitReviewFileDiffSchema.parse(await new GitReviewReader(repoDir).fileDiff({ scope: 'unstaged', path: 'new.txt' }))
        expect(txtDiff.after).toBe('hello\nworld\n')
    })

    it('oversize 单点打标：行数超阈值的条目 oversize:true，各档一致', async () => {
        // 未暂存：untracked 大文件（5001 行 > OVERSIZE_DIFF_LINES）
        const lines = Array.from({ length: 5001 }, (_, i) => `line ${i}`)
        await write('big-untracked.txt', lines.join('\n') + '\n')
        // 未提交：tracked 大文件整文件改写（5001 行 modify）
        await write('big-tracked.txt', lines.map((l) => `old ${l}`).join('\n') + '\n')
        await git('add', 'big-tracked.txt')
        await git('commit', '-qm', 'big-tracked')
        await write('big-tracked.txt', lines.map((l) => `new ${l}`).join('\n') + '\n')

        const data = GitReviewDataSchema.parse(await new GitReviewReader(repoDir).reviewData(SESSION_ID, store))
        const untracked = data.scopes.unstaged.files.find((f) => f.path === 'big-untracked.txt')!
        expect(untracked.oversize).toBe(true)
        const small = data.scopes.unstaged.files.find((f) => f.path === 'new.txt')!
        expect(small.oversize).toBeUndefined()
        const tracked = data.scopes.uncommitted.files.find((f) => f.path === 'big-tracked.txt')!
        expect(tracked.oversize).toBe(true)
    })
})

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
