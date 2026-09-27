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
 * git 适配器真仓库集成测试：临时目录 git init 走真实 git 命令，背书与内存
 * fake 同一接口契约。引用命名/排除 pathspec/各 diff kind 的解析格式以本测试为准。
 */

import { afterAll, beforeAll, describe, it, expect } from 'vitest'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { openTurnSnapshotStore } from '@/modules/common/git/gitTurnSnapshotStore'

const execFileAsync = promisify(execFile)

let repoDir: string

async function git(...args: string[]): Promise<string> {
    const { stdout } = await execFileAsync('git', args, { cwd: repoDir })
    return stdout
}

async function write(relPath: string, content: string | Buffer): Promise<void> {
    const full = join(repoDir, relPath)
    await mkdir(join(full, '..'), { recursive: true })
    await writeFile(full, content)
}

beforeAll(async () => {
    repoDir = await mkdtemp(join(tmpdir(), 'mobi-turn-snap-'))
    await git('init', '-q')
    await git('config', 'user.email', 'test@mobi.local')
    await git('config', 'user.name', 'mobi-test')
    // 初始提交：让 rename 检测与 HEAD 语义可用
    await write('README.md', '# t\n')
    await git('add', '-A')
    await git('commit', '-qm', 'init')
})

afterAll(async () => {
    await rm(repoDir, { recursive: true, force: true })
})

describe('openTurnSnapshotStore（真 git 集成）', () => {
    it('非 git 目录返回 null（显式不可用，不抛错）', async () => {
        const plainDir = await mkdtemp(join(tmpdir(), 'mobi-no-git-'))
        try {
            expect(await openTurnSnapshotStore(plainDir)).toBeNull()
        } finally {
            await rm(plainDir, { recursive: true, force: true })
        }
    })

    it('capture：引用从 1 递增、tree 为 40 位 SHA、链按序可读', async () => {
        const store = (await openTurnSnapshotStore(repoDir))!
        await write('a.txt', 'hello\n')
        const r1 = await store.capture('s-cap')
        const r2 = await store.capture('s-cap')
        expect(r1.index).toBe(1)
        expect(r2.index).toBe(2)
        expect(r1.tree).toMatch(/^[0-9a-f]{40}$/)
        expect(await store.listChain('s-cap')).toEqual([r1, r2])
        expect(await store.listChain('s-other')).toEqual([])
        await store.clearSession('s-cap')
    })

    it('快照排除 .mobi/artifacts 且尊重 .gitignore', async () => {
        const store = (await openTurnSnapshotStore(repoDir))!
        await write('.gitignore', 'ignored.txt\n')
        await write('.mobi/artifacts/2026-09/out.png', 'artifact-bytes')
        await write('ignored.txt', 'should-not-enter')
        await write('tracked.txt', 'real-change\n')
        const { tree } = await store.capture('s-excl')
        // 快照树里没有产物与被忽略文件
        const lsTree = await git('ls-tree', '-r', '--name-only', tree)
        expect(lsTree).not.toContain('.mobi/')
        expect(lsTree).not.toContain('ignored.txt')
        expect(lsTree).toContain('tracked.txt')
        await store.clearSession('s-excl')
    })

    it('diffTrees：add/modify/delete/rename/binary 五类判定与计数正确', async () => {
        const store = (await openTurnSnapshotStore(repoDir))!
        await write('a.txt', 'one\n')
        await write('old-name.txt', 'move me\n')
        const base = await store.capture('s-diff')

        await write('a.txt', 'one\ntwo\n')            // modify +1 -0
        await write('gone.txt', 'farewell\n')          // add（本树新增）
        await write('new-name.txt', 'move me\n')       // rename（-M 相似度检测）
        await rm(join(repoDir, 'old-name.txt'))
        await write('bin.dat', Buffer.from([0x00, 0x01, 0x02, 0x03])) // binary
        const head = await store.capture('s-diff')

        const entries = await store.diffTrees(base.tree, head.tree)
        const byPath = new Map(entries.map((e) => [e.path, e]))

        expect(byPath.get('a.txt')).toMatchObject({ kind: 'modify', additions: 1, deletions: 0, binary: false })
        expect(byPath.get('gone.txt')).toMatchObject({ kind: 'add', binary: false })
        expect(byPath.get('new-name.txt')).toMatchObject({ kind: 'rename', previousPath: 'old-name.txt' })
        expect(byPath.get('bin.dat')).toMatchObject({ kind: 'add', binary: true, additions: 0, deletions: 0 })
        expect(entries.find((e) => e.path === 'old-name.txt')).toBeUndefined()

        // 反向 diff：delete 出现，rename 换向
        const reverse = await store.diffTrees(head.tree, base.tree)
        const revByPath = new Map(reverse.map((e) => [e.path, e]))
        expect(revByPath.get('a.txt')).toMatchObject({ kind: 'modify', additions: 0, deletions: 1 })
        expect(revByPath.get('old-name.txt')).toMatchObject({ kind: 'rename', previousPath: 'new-name.txt' })
        await store.clearSession('s-diff')
    })

    it('diffTrees：同树返回空数组', async () => {
        const store = (await openTurnSnapshotStore(repoDir))!
        const { tree } = await store.capture('s-same')
        expect(await store.diffTrees(tree, tree)).toEqual([])
        await store.clearSession('s-same')
    })

    it('clearSession：清光引用并返回数量，幂等', async () => {
        const store = (await openTurnSnapshotStore(repoDir))!
        await store.capture('s-clear')
        await store.capture('s-clear')
        expect(await store.clearSession('s-clear')).toBe(2)
        expect(await store.listChain('s-clear')).toEqual([])
        expect(await store.clearSession('s-clear')).toBe(0)
    })

    it('不碰用户暂存区与工作区（临时 index 隔离）', async () => {
        const store = (await openTurnSnapshotStore(repoDir))!
        await write('staged-check.txt', 'user staged this\n')
        await git('add', 'staged-check.txt')
        await store.capture('s-isolate')
        // 快照后用户暂存区仍在
        const status = await git('status', '--porcelain')
        expect(status).toContain('A  staged-check.txt')
        // 工作区文件原样
        expect(await readFile(join(repoDir, 'staged-check.txt'), 'utf8')).toContain('user staged')
        await store.clearSession('s-isolate')
    })
})
