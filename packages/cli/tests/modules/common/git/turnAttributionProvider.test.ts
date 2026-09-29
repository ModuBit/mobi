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
 * TurnAttributionProvider 单测（turn-archive B 票02 单层化）：归档唯一供数源——
 * entriesOf/patchOf 直读封口定稿 + turnIndex 越界拒绝 + 路径闸。归档走规范路径
 * 落盘（provider 的 cwd 装配语义）。
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TurnAttributionProvider, gatePathForSource } from '@/modules/common/git/turnAttributionProvider'
import { FileTurnArchiveStore, getTurnArchivePath } from '@/modules/common/git/turnArchiveStore'
import { FileTurnFulltextStore, getTurnFulltextRoot } from '@/modules/common/git/turnFulltextStore'

const DIR_SID = 's-1'

describe('TurnAttributionProvider（归档单层供数）', () => {
    let dir: string

    beforeAll(async () => {
        dir = await mkdtemp(join(tmpdir(), 'mobi-attribution-'))
    })

    afterAll(async () => {
        await rm(dir, { recursive: true, force: true })
    })

    async function sealLatest(sid: string, files: Array<{ path: string; kind?: 'add' | 'modify' | 'delete'; patch?: string; oversizedPatch?: boolean }>): Promise<void> {
        const archive = new FileTurnArchiveStore(getTurnArchivePath(dir, sid))
        await archive.seal({
            turnIndex: 7,
            baseTurnIndex: 6,
            sealedAt: 1_700_000_000_000,
            files: files.map((f) => ({
                path: f.path,
                kind: f.kind ?? 'modify',
                additions: 1,
                deletions: 0,
                writeCount: 1,
                toolNames: ['Edit'],
                patch: f.patch ?? '-x\n+y\n',
                oversizedPatch: f.oversizedPatch ?? false,
            })),
        })
    }

    it('entriesOf：归档条目直读（kind/counts 封口定稿，untracked 事实保持）；无归档 = 空', async () => {
        await sealLatest(DIR_SID, [{ path: 'a.ts' }])
        const provider = new TurnAttributionProvider(dir)

        const entries = await provider.entriesOf(DIR_SID, { kind: 'turn' })
        expect(entries.map((f) => f.path)).toEqual(['a.ts'])
        expect(entries[0]).toMatchObject({ kind: 'modify', additions: 1, deletions: 0, untracked: true })

        expect(await provider.entriesOf('no-archive', { kind: 'turn' })).toEqual([])
    })

    it('patchOf：patch 直读归档封口定稿（含 oversized 打标）；未记录路径 / 无归档 = null', async () => {
        await sealLatest(DIR_SID, [
            { path: 'a.ts' },
            { path: 'big.ts', patch: '', oversizedPatch: true },
        ])
        const provider = new TurnAttributionProvider(dir)

        await expect(provider.patchOf(DIR_SID, { kind: 'turn' }, 'a.ts')).resolves.toEqual({ patch: '-x\n+y\n', oversizedPatch: false })
        await expect(provider.patchOf(DIR_SID, { kind: 'turn' }, 'big.ts')).resolves.toEqual({ patch: '', oversizedPatch: true })
        await expect(provider.patchOf(DIR_SID, { kind: 'turn' }, 'not-recorded.ts')).resolves.toBeNull()
        await expect(provider.patchOf('no-archive', { kind: 'turn' }, 'a.ts')).resolves.toBeNull()
    })

    it('带历史 turnIndex（滚动单条下非最新）：抛错（明确请求了不存在的轮次）；最新轮可命中', async () => {
        const provider = new TurnAttributionProvider(dir)
        await expect(provider.resolve(DIR_SID, { kind: 'turn', turnIndex: 7 })).resolves.toEqual(expect.objectContaining({ turnIndex: 7 }))
        await expect(provider.resolve(DIR_SID, { kind: 'turn', turnIndex: 1 })).rejects.toThrow(/not found/)
    })

    it('patchOf 路径闸：workspace 闸（cwd 外绝对路径拒绝）', async () => {
        await sealLatest(DIR_SID, [{ path: 'a.ts' }])
        const provider = new TurnAttributionProvider(dir)
        await expect(provider.patchOf(DIR_SID, { kind: 'turn' }, '/etc/passwd')).rejects.toThrow(/Invalid path/)
        await expect(provider.patchOf(DIR_SID, { kind: 'turn' }, join(dir, '..', 'escape'))).rejects.toThrow(/Invalid path/)
    })

    it('非 turn 目标拒绝（resolver 职责边界）', async () => {
        const provider = new TurnAttributionProvider(dir)
        await expect(provider.resolve(DIR_SID, { kind: 'worktree', area: 'unstaged' })).rejects.toThrow(/turn/)
    })
})

// ── hydration 读侧（ref 消费：oversized 现场合成 + contents 历史轮全文）─────────
describe('TurnAttributionProvider hydration 读侧', () => {
    let dir: string
    const sid = 'hydration-s'
    const bigPath = () => join(dir, 'big.ts')
    const hisPath = () => join(dir, 'his.ts')

    beforeAll(async () => {
        dir = await mkdtemp(join(tmpdir(), 'mobi-attribution-hydration-'))
        // 真实全文目录（a/b 落盘）+ 带 ref 的归档：big.ts oversized、his.ts 常规
        const store = new FileTurnFulltextStore(getTurnFulltextRoot(dir, sid), dir)
        const sealed = await store.sealFiles(7, [
            { path: bigPath(), beforeContent: 'a\n'.repeat(50), afterContent: 'b\n'.repeat(50) },
            { path: hisPath(), beforeContent: 'old\n', afterContent: 'new\n' },
        ])
        const archive = new FileTurnArchiveStore(getTurnArchivePath(dir, sid))
        await archive.seal({
            turnIndex: 7,
            baseTurnIndex: 6,
            sealedAt: 1,
            files: [
                { path: bigPath(), kind: 'modify', additions: 50, deletions: 50, writeCount: 1, toolNames: ['Write'], patch: '', oversizedPatch: true, ref: sealed.get(bigPath())!.ref },
                // 无 ref 的 oversized 条目（旧归档形状）
                { path: join(dir, 'legacy.ts'), kind: 'modify', additions: 1, deletions: 0, writeCount: 1, toolNames: ['Edit'], patch: '', oversizedPatch: true },
                { path: hisPath(), kind: 'modify', additions: 1, deletions: 0, writeCount: 1, toolNames: ['Edit'], patch: '-old\n+new\n', oversizedPatch: false, ref: sealed.get(hisPath())!.ref },
            ],
        })
        // 工作区实况偏离该轮事实：contents 应返回归档全文而非当前盘上内容
        const { writeFile } = await import('node:fs/promises')
        await writeFile(hisPath(), 'workspace-diverged\n')
    })

    afterAll(async () => {
        await rm(dir, { recursive: true, force: true })
    })

    it('patchOf：oversized 带 ref → 读全文现场合成 patch（oversized 解除）；无 ref → 维持空+打标', async () => {
        const provider = new TurnAttributionProvider(dir)
        const synthesized = await provider.patchOf(sid, { kind: 'turn' }, bigPath())
        expect(synthesized).toEqual({ patch: expect.stringContaining('+b'), oversizedPatch: false })
        expect(synthesized!.patch).toContain('-a')

        await expect(provider.patchOf(sid, { kind: 'turn' }, join(dir, 'legacy.ts'))).resolves.toEqual({ patch: '', oversizedPatch: true })
    })

    it('patchOf：ref 指向的全文缺失（目录被清理）→ 合成为空，回退空+打标', async () => {
        // 独立 sid 的空全文目录：不污染其他用例的夹具
        const goneSid = 'hydration-gone'
        const archive = new FileTurnArchiveStore(getTurnArchivePath(dir, goneSid))
        await archive.seal({
            turnIndex: 7,
            baseTurnIndex: null,
            sealedAt: 1,
            files: [{ path: bigPath(), kind: 'modify', additions: 1, deletions: 0, writeCount: 1, toolNames: ['Edit'], patch: '', oversizedPatch: true, ref: { before: 'a/big.ts', after: 'b/big.ts' } }],
        })
        const provider = new TurnAttributionProvider(dir)
        await expect(provider.patchOf(goneSid, { kind: 'turn' }, bigPath())).resolves.toEqual({ patch: '', oversizedPatch: true })
    })

    it('contentsOf：带 ref → 归档全文（工作区已偏离仍返回该轮事实）；无 ref / 未记录 / 无归档 = null', async () => {
        const provider = new TurnAttributionProvider(dir)
        await expect(provider.contentsOf(sid, { kind: 'turn' }, hisPath())).resolves.toEqual({ before: 'old\n', after: 'new\n' })
        await expect(provider.contentsOf(sid, { kind: 'turn' }, join(dir, 'legacy.ts'))).resolves.toBeNull()
        await expect(provider.contentsOf(sid, { kind: 'turn' }, join(dir, 'not-recorded.ts'))).resolves.toBeNull()
        await expect(provider.contentsOf('no-archive', { kind: 'turn' }, hisPath())).resolves.toBeNull()
    })

    it('contentsOf 路径闸：workspace 闸与 patchOf 同规则', async () => {
        const provider = new TurnAttributionProvider(dir)
        await expect(provider.contentsOf(sid, { kind: 'turn' }, '/etc/passwd')).rejects.toThrow(/Invalid path/)
    })
})

describe('gatePathForSource（闸分流）', () => {
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
