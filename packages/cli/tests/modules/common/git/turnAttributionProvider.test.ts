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
 * TurnAttributionProvider 单测（审查 v3 供数反转结构收口）：降级链单点
 * （封口归档 → 快照两树 → journal）逐档断言 + 「上一轮」判定 + turnIndex 越界 +
 * 路径闸随源走。归档/journal 走规范路径落盘（provider 的 cwd 装配语义），快照链用
 * 内存 fake，git 条目组装用桩（provider 不跑真 git，端到端行为由 gitReview.test.ts
 * 真仓库集成测试护栏）。
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TurnAttributionProvider, gatePathForSource, type TurnAttributionGitOps } from '@/modules/common/git/turnAttributionProvider'
import { createInMemoryTurnSnapshotStore, type TurnSnapshotStore } from '@/modules/common/git/turnSnapshotStore'
import { FileTurnArchiveStore, getTurnArchivePath } from '@/modules/common/git/turnArchiveStore'
import { PersistentToolChangeJournal, getToolChangesPath } from '@/modules/common/git/toolChangeJournal'

const DIR_SID = 's-1'

/** git 执行桩：isGit 可切换，entries 记录调用并返回预设条目 */
function stubGitOps(options?: { isGit?: boolean; entries?: Array<{ path: string; kind: 'add' | 'modify'; additions: number; deletions: number }> }): TurnAttributionGitOps & { entriesSpy: ReturnType<typeof vi.fn> } {
    const entriesSpy = vi.fn(async () => options?.entries ?? [])
    return {
        isGitRepository: async () => options?.isGit ?? true,
        entries: entriesSpy,
        entriesSpy,
    }
}

function providerFor(cwd: string, gitOps: TurnAttributionGitOps, store: TurnSnapshotStore | null): TurnAttributionProvider {
    return new TurnAttributionProvider(cwd, store, gitOps)
}

/** 封口一轮进规范路径归档（provider 的 cwd 装配语义可见） */
async function sealTurn(cwd: string, sid: string, turnIndex: number, files: Array<{ path: string; beforeContent: string | null; afterContent: string | null }>): Promise<void> {
    const archive = new FileTurnArchiveStore(getTurnArchivePath(cwd, sid))
    await archive.seal({
        turnIndex,
        baseTurnIndex: turnIndex > 1 ? turnIndex - 1 : null,
        sealedAt: turnIndex,
        files: files.map((f) => ({ ...f, writeCount: 1, toolNames: ['Edit'], additions: 1, deletions: 0 })),
    })
}

describe('TurnAttributionProvider（降级链单点）', () => {
    let dir: string

    beforeAll(async () => {
        dir = await mkdtemp(join(tmpdir(), 'mobi-attribution-'))
    })

    afterAll(async () => {
        await rm(dir, { recursive: true, force: true })
    })

    it('封口归档优先：归档在 → 无视快照链与 journal；「上一轮」= 最新封口轮', async () => {
        await sealTurn(dir, DIR_SID, 1, [{ path: 'a.ts', beforeContent: null, afterContent: 'a\n' }])
        await sealTurn(dir, DIR_SID, 2, [{ path: 'b.ts', beforeContent: 'x\n', afterContent: 'x\ny\n' }])
        const store = createInMemoryTurnSnapshotStore({ chains: { [DIR_SID]: [{ index: 1, tree: 't1' }, { index: 2, tree: 't2' }] } })
        const gitOps = stubGitOps()
        const provider = providerFor(dir, gitOps, store)

        const source = await provider.resolve(DIR_SID, { kind: 'turn' })
        expect(source).toEqual({ kind: 'sealed', record: expect.objectContaining({ turnIndex: 2 }) })
        expect(gitOps.entriesSpy).not.toHaveBeenCalled()

        const entries = await provider.entriesOf(DIR_SID, { kind: 'turn' })
        expect(entries.map((f) => f.path)).toEqual(['b.ts'])
        expect(entries[0]).toMatchObject({ kind: 'modify', additions: 1, deletions: 0, untracked: true })

        // 滚动单条（turn-archive B）：历史轮不再保留——带历史 turnIndex 查询落 not found
        // （快照链已无该序号 pair，journal 兜底会给错数据故拒绝）
        await expect(provider.resolve(DIR_SID, { kind: 'turn', turnIndex: 1 })).rejects.toThrow(/not found/)
    })

    it('非 git 目录归档仍优先（归档检查先于 isGit 判定，与既有 overview/files 行为一致）', async () => {
        const sid = 'nongit-sealed'
        await sealTurn(dir, sid, 1, [{ path: 'a.ts', beforeContent: null, afterContent: 'a\n' }])
        const provider = providerFor(dir, stubGitOps({ isGit: false }), null)
        expect(await provider.resolve(sid, { kind: 'turn' })).toEqual({ kind: 'sealed', record: expect.objectContaining({ turnIndex: 1 }) })
    })

    it('无归档：快照链尾 pair 兜底（实况源）；带 turnIndex = 链上该序号与其前一颗', async () => {
        const sid = 'chain-fallback'
        const store = createInMemoryTurnSnapshotStore({
            chains: { [sid]: [{ index: 1, tree: 't1' }, { index: 2, tree: 't2' }, { index: 3, tree: 't3' }] },
        })
        const provider = providerFor(dir, stubGitOps(), store)
        await expect(provider.resolve(sid, { kind: 'turn' })).resolves.toEqual({ kind: 'snapshot', baseTree: 't2', headTree: 't3' })
        await expect(provider.resolve(sid, { kind: 'turn', turnIndex: 2 })).resolves.toEqual({ kind: 'snapshot', baseTree: 't1', headTree: 't2' })
    })

    it('journal 末位：非 git / store null / 链不足（tailPair null）均降级 journal（toolSourceOnly 收口）', async () => {
        const sid = 'journal-last'
        const gitProvider = providerFor(dir, stubGitOps({ isGit: false }), null)
        await expect(gitProvider.resolve(sid, { kind: 'turn' })).resolves.toEqual({ kind: 'journal' })

        const gitEmptyChain = providerFor(dir, stubGitOps(), createInMemoryTurnSnapshotStore())
        await expect(gitEmptyChain.resolve(sid, { kind: 'turn' })).resolves.toEqual({ kind: 'journal' })

        const gitNoStore = providerFor(dir, stubGitOps(), null)
        await expect(gitNoStore.resolve(sid, { kind: 'turn' })).resolves.toEqual({ kind: 'journal' })

        // 链只有一颗（无 baseline pair）：同降级
        const gitShortChain = providerFor(dir, stubGitOps(), createInMemoryTurnSnapshotStore({ chains: { [sid]: [{ index: 1, tree: 't1' }] } }))
        await expect(gitShortChain.resolve(sid, { kind: 'turn' })).resolves.toEqual({ kind: 'journal' })
    })

    it('带 turnIndex 而归档与快照链均未覆盖：抛错（明确请求了不存在的轮次）', async () => {
        const sid = 'turn-index-miss'
        const provider = providerFor(dir, stubGitOps(), createInMemoryTurnSnapshotStore({ chains: { [sid]: [{ index: 1, tree: 't1' }] } }))
        await expect(provider.resolve(sid, { kind: 'turn', turnIndex: 9 })).rejects.toThrow(/not found/)
    })

    it('entriesOf 快照源：git 条目 ∪ journal 补入（git 视野外路径，不重复），untracked 事实保持', async () => {
        const sid = 'snapshot-entries'
        const journal = await PersistentToolChangeJournal.open(getToolChangesPath(dir, sid))
        journal.record({ path: 'secret.local', beforeContent: null, afterContent: 'hush\n', toolName: 'Write' })
        journal.record({ path: 'a.ts', beforeContent: null, afterContent: 'stale\n', toolName: 'Write' })
        await journal.flush()

        const store = createInMemoryTurnSnapshotStore({
            chains: { [sid]: [{ index: 1, tree: 't1' }, { index: 2, tree: 't2' }] },
        })
        const gitOps = stubGitOps({ entries: [{ path: 'a.ts', kind: 'modify', additions: 2, deletions: 1 }] })
        const provider = providerFor(dir, gitOps, store)

        const entries = await provider.entriesOf(sid, { kind: 'turn' })
        expect(entries.map((f) => f.path)).toEqual(['a.ts', 'secret.local'])
        expect(entries[0]).toMatchObject({ kind: 'modify', additions: 2, deletions: 1, untracked: false })
        expect(entries[1]).toMatchObject({ kind: 'add', untracked: true })
        expect(gitOps.entriesSpy).toHaveBeenCalledWith(['diff', 't1', 't2', '-M'])
    })

    it('entriesOf journal 源：loadToolJournalForReview 补全后供数（after 占位 null 用磁盘内容补）', async () => {
        const sid = 'journal-after'
        // 磁盘当前内容 = 编辑后已落盘的文件（E2E 实证票09 的补全语义）
        const filePath = join(dir, 'app.ts')
        await writeFile(filePath, 'a\nb\nedited\n')
        const journal = await PersistentToolChangeJournal.open(getToolChangesPath(dir, sid))
        journal.record({ path: filePath, beforeContent: 'a\nb\n', toolName: 'Edit' })
        await journal.flush()

        const provider = providerFor(dir, stubGitOps(), null)
        const entries = await provider.entriesOf(sid, { kind: 'turn' })
        expect(entries).toHaveLength(1)
        expect(entries[0]).toMatchObject({ path: filePath, kind: 'modify', additions: 1, deletions: 0 })
    })

    it('pairOf 内容型源：归档/journal 直出内容对；未记录路径 = null（降级语义归调用方）', async () => {
        const sid = 'pair-contents'
        await sealTurn(dir, sid, 1, [{ path: 'a.ts', beforeContent: 'one\n', afterContent: 'one\ntwo\n' }])
        const provider = providerFor(dir, stubGitOps(), createInMemoryTurnSnapshotStore())

        await expect(provider.pairOf(sid, { kind: 'turn' }, 'a.ts')).resolves.toEqual({ kind: 'contents', before: 'one\n', after: 'one\ntwo\n' })
        await expect(provider.pairOf(sid, { kind: 'turn' }, 'not-recorded.ts')).resolves.toBeNull()

        // journal 源内容对
        const jsid = 'pair-journal'
        const journal = await PersistentToolChangeJournal.open(getToolChangesPath(dir, jsid))
        journal.record({ path: 'j.ts', beforeContent: 'b\n', afterContent: 'b\nc\n', toolName: 'Edit' })
        await journal.flush()
        const journalProvider = providerFor(dir, stubGitOps({ isGit: false }), null)
        await expect(journalProvider.pairOf(jsid, { kind: 'turn' }, 'j.ts')).resolves.toEqual({ kind: 'contents', before: 'b\n', after: 'b\nc\n' })
    })

    it('pairOf 路径闸随源走：内容型源 = 工作区闸，快照源 = 仓库相对闸', async () => {
        const sid = 'gate-contents'
        await sealTurn(dir, sid, 1, [{ path: 'a.ts', beforeContent: 'one\n', afterContent: 'one\ntwo\n' }])
        const sealedProvider = providerFor(dir, stubGitOps(), createInMemoryTurnSnapshotStore())
        // 内容型源：cwd 外绝对路径拒绝（先闸后查条目）
        await expect(sealedProvider.pairOf(sid, { kind: 'turn' }, '/etc/passwd')).rejects.toThrow(/Invalid path/)
        await expect(sealedProvider.pairOf(sid, { kind: 'turn' }, join(dir, '..', 'escape'))).rejects.toThrow(/Invalid path/)

        const gsid = 'gate-snapshot'
        const snapshotProvider = providerFor(dir, stubGitOps(), createInMemoryTurnSnapshotStore({
            chains: { [gsid]: [{ index: 1, tree: 't1' }, { index: 2, tree: 't2' }] },
        }))
        await expect(snapshotProvider.pairOf(gsid, { kind: 'turn' }, '../escape')).rejects.toThrow(/Invalid path/)
        await expect(snapshotProvider.pairOf(gsid, { kind: 'turn' }, 'a.ts')).resolves.toEqual({ kind: 'snapshot', baseTree: 't1', headTree: 't2' })
    })

    it('pairOf 快照源：journal 补入的 gitignored 路径由 journal 供内容对（清单可见即渲染得出，与 entriesOf 补入对齐）', async () => {
        const sid = 'pair-snapshot-journal'
        // entriesOf 快照源把 git 视野外路径（绝对路径 gitignored 文件等）补进文件清单；
        // pairOf 对同一路径必须给得出内容对——闸拒绝的形状查 journal，命中走工作区闸
        const secretPath = join(dir, 'secret.local')
        const journal = await PersistentToolChangeJournal.open(getToolChangesPath(dir, sid))
        journal.record({ path: secretPath, beforeContent: null, afterContent: 'hush\n', toolName: 'Write' })
        await journal.flush()

        const provider = providerFor(dir, stubGitOps(), createInMemoryTurnSnapshotStore({
            chains: { [sid]: [{ index: 1, tree: 't1' }, { index: 2, tree: 't2' }] },
        }))
        await expect(provider.pairOf(sid, { kind: 'turn' }, secretPath)).resolves.toEqual({ kind: 'contents', before: null, after: 'hush\n' })
        // journal 也没有的非法路径：维持 Invalid path 契约（真非法 ≠ 补入缺记录）
        await expect(provider.pairOf(sid, { kind: 'turn' }, '/etc/passwd')).rejects.toThrow(/Invalid path/)
        // git 视野内路径（仓库相对形状）仍走快照两树出口，不绕 journal
        await expect(provider.pairOf(sid, { kind: 'turn' }, 'a.ts')).resolves.toEqual({ kind: 'snapshot', baseTree: 't1', headTree: 't2' })
    })

    it('非 turn 目标拒绝（resolver 职责边界）', async () => {
        const provider = providerFor(dir, stubGitOps(), null)
        await expect(provider.resolve(DIR_SID, { kind: 'worktree', area: 'unstaged' })).rejects.toThrow(/turn/)
    })
})

describe('gatePathForSource（③ 闸分流收口）', () => {
    const cwd = '/repo/workspace'

    it("git 源 = 仓库相对闸：绝对路径 / `..` 逃逸拒绝；repoRoot 给出时校验落在仓库内", () => {
        expect(() => gatePathForSource('git', 'a/b.ts', cwd, '/repo')).not.toThrow()
        expect(() => gatePathForSource('git', '/etc/passwd', cwd, '/repo')).toThrow(/Invalid path/)
        expect(() => gatePathForSource('git', '../escape', cwd, '/repo')).toThrow(/Invalid path/)
        // 正常输入的解析必在 repoRoot 内（防御闭环分支不误伤）
        expect(() => gatePathForSource('git', 'sub/../a.ts', cwd, '/repo')).toThrow(/Invalid path/)
    })

    it("workspace 源 = 工作区闸：cwd 外绝对路径拒绝（repoRoot 不参与）", () => {
        expect(() => gatePathForSource('workspace', join(cwd, 'a.ts'), cwd, null)).not.toThrow()
        expect(() => gatePathForSource('workspace', '/etc/passwd', cwd, null)).toThrow(/Invalid path/)
    })
})
