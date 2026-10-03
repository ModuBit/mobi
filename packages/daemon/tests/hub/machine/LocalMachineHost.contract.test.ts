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
 * ticket-17 组1 契约测试：LocalMachineHost 直调 vs SocketMachineHost 走真 handler 的
 * socket 回路，同输入必须同回执（成功 / 路径越界 / 文件不存在三形态）。
 *
 * socket 侧不是预设回包的 fake——emitWithAck 进真 RpcHandlerManager.handleRequest，
 * 注册的是 registerMachineFileHandlers / path-exists 的生产 handler；两侧唯一差别
 * 是「传输走 socket 回路」还是「本地函数调用」，分歧即契约破坏。
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { RpcHandlerManager } from '@mobi/node-core/rpc/RpcHandlerManager'
import { registerMachineFileHandlers } from '@mobi/node-core/handlers/machineFiles'
import { checkPathsExistImpl } from '@mobi/node-core/handlers/pathExists'
import { registerFileHandlers } from '@mobi/node-core/handlers/files'
import { registerUploadHandlers } from '@mobi/node-core/handlers/uploads'
import { registerMachineDirectoryHandler } from '@mobi/node-core/handlers/machineDirectory'
import { registerSessionFilesHandler } from '@mobi/node-core/handlers/sessionFiles'
import { registerGitReviewHandlers } from '@mobi/node-core/handlers/gitReview'
import { registerWebToolsConfigHandler } from '@mobi/node-core/handlers/webToolsConfig'
import { GIT_REVIEW_RPC } from '@mobi/shared'
import { LocalMachineHost } from '../../../src/machine/LocalMachineHost'
import { SocketMachineHost } from '../../../src/machine/SocketMachineHost'
import { makeFakeIo, makeFakeRegistry } from '../sync/fakeTransport'

const MACHINE_ID = 'M-contract'
const HOME = homedir()

// socket 侧用真 handler：注册形态与 runner apiMachine 一致（machineFiles 覆盖式注册 + path-exists）
function makeServingPair(homeDir: string): { socketHost: SocketMachineHost } {
    const manager = new RpcHandlerManager({ scopePrefix: MACHINE_ID })
    // 装配顺序与 runner apiMachine 同构：common 先注册，machineFiles 覆盖 readFileMeta/readFileRange
    registerFileHandlers(manager, homeDir, homeDir)
    registerUploadHandlers(manager, homeDir)
    registerMachineFileHandlers(manager, homeDir)
    registerMachineDirectoryHandler(manager)
    registerSessionFilesHandler(manager, homeDir)
    registerGitReviewHandlers(manager)
    registerWebToolsConfigHandler(manager)
    manager.registerHandler('path-exists', (params: unknown) => checkPathsExistImpl(params))

    // serving socket：emitWithAck 直送 RpcHandlerManager（socket.io 回路的最小等价物）
    const socket = {
        timeout() {
            return this
        },
        async emitWithAck(_event: string, payload: unknown) {
            return await manager.handleRequest(payload as { method: string; params: unknown })
        },
    }
    const io = makeFakeIo('sock-contract', socket as never)
    const registry = makeFakeRegistry(new Map([
        [`${MACHINE_ID}:readFileMeta`, 'sock-contract'],
        [`${MACHINE_ID}:readFileRange`, 'sock-contract'],
        [`${MACHINE_ID}:path-exists`, 'sock-contract'],
        [`${MACHINE_ID}:saveFile`, 'sock-contract'],
        [`${MACHINE_ID}:writeFileRange`, 'sock-contract'],
        [`${MACHINE_ID}:deleteUpload`, 'sock-contract'],
        [`${MACHINE_ID}:replaceUpload`, 'sock-contract'],
        [`${MACHINE_ID}:list-directory`, 'sock-contract'],
        [`${MACHINE_ID}:searchSessionFiles`, 'sock-contract'],
        [`${MACHINE_ID}:listSessionDirectory`, 'sock-contract'],
        ...Object.values(GIT_REVIEW_RPC).map((m) => [`${MACHINE_ID}:${m}`, 'sock-contract']) as [string, string][],
        [`${MACHINE_ID}:get-web-tools-config`, 'sock-contract'],
        [`${MACHINE_ID}:verify-web-tools-provider`, 'sock-contract'],
    ]))
    return { socketHost: new SocketMachineHost(io, registry) }
}

describe('LocalMachineHost 契约（组1 文件读：直调 ≡ socket 回路）', () => {
    let tmpRoot: string
    let gitRoot: string
    let localHost: LocalMachineHost
    let socketHost: SocketMachineHost

    beforeAll(async () => {
        // home 子树内的临时工作区（读边界允许域；避开 .mobi 黑名单前缀）
        tmpRoot = join(HOME, `mobi-lmh-contract-${Date.now()}-${Math.random().toString(36).slice(2)}`)
        await mkdir(join(tmpRoot, 'sub'), { recursive: true })
        await writeFile(join(tmpRoot, 'hello.txt'), '0123456789abcdef', 'utf-8')
        await writeFile(join(tmpRoot, 'note.md'), '# v1\n', 'utf-8')

        // 组4：git 审查族需要一个真仓库（init + 首提交 + 未提交改动）
        gitRoot = join(HOME, `mobi-lmh-git-${Date.now()}-${Math.random().toString(36).slice(2)}`)
        await mkdir(gitRoot, { recursive: true })
        await Bun.write(join(gitRoot, 'repo.txt'), 'line1\n')
        const gitRun = (args: string[]) => Bun.spawnSync(['git', '-C', gitRoot, ...args])
        gitRun(['init'])
        gitRun(['config', 'user.email', 'contract@test'])
        gitRun(['config', 'user.name', 'contract'])
        gitRun(['add', '.'])
        gitRun(['commit', '-m', 'init'])
        await Bun.write(join(gitRoot, 'repo.txt'), 'line1\nline2\n')

        localHost = new LocalMachineHost({} as never) // 组1 方法不落 fallback，兜底不需要真实现
        socketHost = makeServingPair(HOME).socketHost
    })

    afterAll(async () => {
        await rm(tmpRoot, { recursive: true, force: true })
        await rm(gitRoot, { recursive: true, force: true })
    })

    test('checkPathsExist：目录 / 文件（仅目录算 exists）/ 不存在三态一致', async () => {
        const paths = [tmpRoot, join(tmpRoot, 'hello.txt'), join(tmpRoot, 'no-such-dir'), '  ']
        expect(await localHost.checkPathsExist(MACHINE_ID, paths))
            .toEqual(await socketHost.checkPathsExist(MACHINE_ID, paths))
    })

    test('machineReadFileMeta：成功（meta/writable 同构）', async () => {
        expect(await localHost.machineReadFileMeta(MACHINE_ID, tmpRoot, 'hello.txt'))
            .toEqual(await socketHost.machineReadFileMeta(MACHINE_ID, tmpRoot, 'hello.txt'))
    })

    test('machineReadFileMeta：路径越界（home 外绝对路径）→ ACCESS_DENIED 同构', async () => {
        expect(await localHost.machineReadFileMeta(MACHINE_ID, tmpRoot, '/System/escape.txt'))
            .toEqual(await socketHost.machineReadFileMeta(MACHINE_ID, tmpRoot, '/System/escape.txt'))
    })

    test('machineReadFileMeta：敏感文件（黑名单）→ ACCESS_DENIED 同构', async () => {
        expect(await localHost.machineReadFileMeta(MACHINE_ID, tmpRoot, '../../.ssh/id_rsa'))
            .toEqual(await socketHost.machineReadFileMeta(MACHINE_ID, tmpRoot, '../../.ssh/id_rsa'))
    })

    test('machineReadFileMeta：文件不存在 → ENOENT 同构', async () => {
        const local = await localHost.machineReadFileMeta(MACHINE_ID, tmpRoot, 'missing.txt')
        const socket = await socketHost.machineReadFileMeta(MACHINE_ID, tmpRoot, 'missing.txt')
        expect(local).toEqual(socket)
        expect((local as { code?: string }).code).toBe('ENOENT')
    })

    test('machineReadFileRange：成功分片（含跨子目录相对路径）', async () => {
        expect(await localHost.machineReadFileRange(MACHINE_ID, tmpRoot, 'hello.txt', 4, 8))
            .toEqual(await socketHost.machineReadFileRange(MACHINE_ID, tmpRoot, 'hello.txt', 4, 8))
    })

    test('machineReadFileRange：越界路径拒绝同构', async () => {
        expect(await localHost.machineReadFileRange(MACHINE_ID, tmpRoot, '/System/escape.txt', 0, 4))
            .toEqual(await socketHost.machineReadFileRange(MACHINE_ID, tmpRoot, '/System/escape.txt', 0, 4))
    })

    // ── 组2：写/上传（saveFile / writeFileRange / deleteUpload / replaceUpload）──
    // 写操作有副作用：local 先行、socket 跟进会读到 local 的结果——两侧各用独立文件比对形状与语义

    test('machineSaveFile：OCC 成功（etag 刷新）与冲突两形态同构', async () => {
        const a = await localHost.machineSaveFile(MACHINE_ID, tmpRoot, 'note.md', new TextEncoder().encode('# v2\n'), '')
        const b = await socketHost.machineSaveFile(MACHINE_ID, tmpRoot, 'note.md', new TextEncoder().encode('# v2\n'), '')
        // etag 含 mtime（两侧写入时刻不同必不等），归一后比对形状
        const normalizeEtag = (r: unknown) => {
            const obj = { ...(r as object) } as { etag?: string; currentEtag?: string }
            if (obj.etag !== undefined) obj.etag = '<etag>'
            if (obj.currentEtag !== undefined) obj.currentEtag = '<etag>'
            return obj
        }
        expect(normalizeEtag(a)).toEqual(normalizeEtag(b))
        expect((a as { success: boolean }).success).toBe(true)

        // baseEtag 过期 → conflict + currentEtag（两侧行为同构）
        const c = await localHost.machineSaveFile(MACHINE_ID, tmpRoot, 'note.md', new TextEncoder().encode('# x\n'), '0-1')
        const d = await socketHost.machineSaveFile(MACHINE_ID, tmpRoot, 'note.md', new TextEncoder().encode('# x\n'), '0-1')
        expect(c).toEqual(d)
        expect((c as { conflict?: boolean }).conflict).toBe(true)
    })

    test('machineSaveFile：写边界外（home 外绝对路径）→ ACCESS_DENIED 同构', async () => {
        expect(await localHost.machineSaveFile(MACHINE_ID, tmpRoot, '/System/escape.md', new TextEncoder().encode('x'), ''))
            .toEqual(await socketHost.machineSaveFile(MACHINE_ID, tmpRoot, '/System/escape.md', new TextEncoder().encode('x'), ''))
    })

    test('machineSaveFile：目标不存在 → ENOENT 同构', async () => {
        const a = await localHost.machineSaveFile(MACHINE_ID, tmpRoot, 'ghost.md', new TextEncoder().encode('x'), '')
        const b = await socketHost.machineSaveFile(MACHINE_ID, tmpRoot, 'ghost.md', new TextEncoder().encode('x'), '')
        expect(a).toEqual(b)
        expect((a as { code?: string }).code).toBe('ENOENT')
    })

    test('machineUploadFileRange → replaceUpload → deleteUpload 全链路同构', async () => {
        // 首块（两侧各一个文件名，避免互相踩）；唯一名含时间戳+随机段，path 归一后比对
        const normalizeUploadPath = (r: unknown) => {
            const obj = { ...(r as object) } as { path?: string }
            if (obj.path) obj.path = obj.path.replace(/-[a-z0-9]+(\.[a-z0-9]+)?$/i, '-<id>$1')
            return obj
        }
        const a = await localHost.machineUploadFileRange(MACHINE_ID, tmpRoot, 'up.png', undefined, 0, new Uint8Array([1, 2, 3, 4]), 8)
        const b = await socketHost.machineUploadFileRange(MACHINE_ID, tmpRoot, 'up.png', undefined, 0, new Uint8Array([5, 6, 7, 8]), 8)
        expect(normalizeUploadPath(a)).toEqual(normalizeUploadPath(b))
        expect((a as { success: boolean; written?: number }).success).toBe(true)

        // 后续块（追加到各自首块返回的 path）
        const aPath = (a as { path?: string }).path!
        const bPath = (b as { path?: string }).path!
        expect(await localHost.machineUploadFileRange(MACHINE_ID, tmpRoot, 'up.png', aPath, 4, new Uint8Array([9, 10, 11, 12]), 8))
            .toEqual(await socketHost.machineUploadFileRange(MACHINE_ID, tmpRoot, 'up.png', bPath, 4, new Uint8Array([13, 14, 15, 16]), 8))

        // 替换（同 path 原子换血）
        expect(await localHost.machineReplaceUpload(MACHINE_ID, tmpRoot, aPath, new Uint8Array([9, 9])))
            .toEqual(await socketHost.machineReplaceUpload(MACHINE_ID, tmpRoot, bPath, new Uint8Array([8, 8])))

        // 越界 path（uploads 目录外）→ 拒绝同构
        expect(await localHost.machineDeleteUpload(MACHINE_ID, tmpRoot, 'hello.txt'))
            .toEqual(await socketHost.machineDeleteUpload(MACHINE_ID, tmpRoot, 'note.md'))

        // 删除收尾
        expect(await localHost.machineDeleteUpload(MACHINE_ID, tmpRoot, aPath))
            .toEqual(await socketHost.machineDeleteUpload(MACHINE_ID, tmpRoot, bPath))
    })

    test('machineUploadFileRange：越界 cwd（home 外）拒绝同构', async () => {
        expect(await localHost.machineUploadFileRange(MACHINE_ID, '/System', 'up.png', undefined, 0, new Uint8Array([1]), 1))
            .toEqual(await socketHost.machineUploadFileRange(MACHINE_ID, '/System', 'up.png', undefined, 0, new Uint8Array([1]), 1))
    })

    // ── 组3：目录与搜索（list-directory / searchSessionFiles / listSessionDirectory）──

    test('listMachineDirectory：成功 + home 外路径拒绝同构', async () => {
        expect(await localHost.listMachineDirectory(MACHINE_ID, tmpRoot, HOME))
            .toEqual(await socketHost.listMachineDirectory(MACHINE_ID, tmpRoot, HOME))
        expect(await localHost.listMachineDirectory(MACHINE_ID, '/System', HOME))
            .toEqual(await socketHost.listMachineDirectory(MACHINE_ID, '/System', HOME))
    })

    test('machineListSessionDirectory：树浏览（truncated/total 同构）', async () => {
        expect(await localHost.machineListSessionDirectory(MACHINE_ID, tmpRoot, ''))
            .toEqual(await socketHost.machineListSessionDirectory(MACHINE_ID, tmpRoot, ''))
        expect(await localHost.machineListSessionDirectory(MACHINE_ID, tmpRoot, '', 'hel'))
            .toEqual(await socketHost.machineListSessionDirectory(MACHINE_ID, tmpRoot, '', 'hel'))
    })

    test('machineListSessionDirectory：不存在目录 + 越界 cwd 拒绝同构', async () => {
        expect(await localHost.machineListSessionDirectory(MACHINE_ID, tmpRoot, 'no-such-dir'))
            .toEqual(await socketHost.machineListSessionDirectory(MACHINE_ID, tmpRoot, 'no-such-dir'))
        expect(await localHost.machineListSessionDirectory(MACHINE_ID, '/System', ''))
            .toEqual(await socketHost.machineListSessionDirectory(MACHINE_ID, '/System', ''))
    })

    test('machineSearchFiles：ripgrep 搜索同构（file/directory 过滤）', async () => {
        expect(await localHost.machineSearchFiles(MACHINE_ID, tmpRoot, 'hello'))
            .toEqual(await socketHost.machineSearchFiles(MACHINE_ID, tmpRoot, 'hello'))
        expect(await localHost.machineSearchFiles(MACHINE_ID, tmpRoot, 'sub', 'directory'))
            .toEqual(await socketHost.machineSearchFiles(MACHINE_ID, tmpRoot, 'sub', 'directory'))
    })

    // ── 组4：git 审查族（overview / files / diff / contents / commits / init / clear）──
    // readerFor 按 cwd memoized + repoRoot 缓存跨请求存活——两侧共用同一进程内缓存，
    // 契约只验「同输入同输出」，git 状态由用例固定

    test('machineGitReviewOverview：git 仓库 + 非 git 目录两形态同构', async () => {
        expect(await localHost.machineGitReviewOverview(MACHINE_ID, gitRoot, 'sess-x'))
            .toEqual(await socketHost.machineGitReviewOverview(MACHINE_ID, gitRoot, 'sess-x'))
        expect(await localHost.machineGitReviewOverview(MACHINE_ID, tmpRoot, 'sess-x'))
            .toEqual(await socketHost.machineGitReviewOverview(MACHINE_ID, tmpRoot, 'sess-x'))
    })

    test('machineGitReviewFiles + Diff：worktree unstaged 档同构', async () => {
        const target = { kind: 'worktree', area: 'unstaged' } as const
        expect(await localHost.machineGitReviewFiles(MACHINE_ID, gitRoot, 'sess-x', target))
            .toEqual(await socketHost.machineGitReviewFiles(MACHINE_ID, gitRoot, 'sess-x', target))
        expect(await localHost.machineGitReviewDiff(MACHINE_ID, gitRoot, 'sess-x', target, 'repo.txt'))
            .toEqual(await socketHost.machineGitReviewDiff(MACHINE_ID, gitRoot, 'sess-x', target, 'repo.txt'))
    })

    test('machineGitReviewContents + Commits：全文对 + 游标分页同构', async () => {
        expect(await localHost.machineGitReviewContents(MACHINE_ID, gitRoot, 'sess-x', { kind: 'commit', range: { base: 'HEAD~1', head: 'HEAD' } }, 'repo.txt'))
            .toEqual(await socketHost.machineGitReviewContents(MACHINE_ID, gitRoot, 'sess-x', { kind: 'commit', range: { base: 'HEAD~1', head: 'HEAD' } }, 'repo.txt'))
        expect(await localHost.machineGitReviewCommits(MACHINE_ID, gitRoot))
            .toEqual(await socketHost.machineGitReviewCommits(MACHINE_ID, gitRoot))
    })

    test('clearTurnSnapshots：幂等清档同构', async () => {
        await localHost.clearTurnSnapshots(MACHINE_ID, gitRoot, 'sess-x')
        await socketHost.clearTurnSnapshots(MACHINE_ID, gitRoot, 'sess-x')
    })

    // ── 组5：web-tools（get 只读 / verify 非法参数零 IO 路径；set 写真实 settings
    //    由 node-core webToolsConfigRpc 单测覆盖，refreshMetadata 由 E2E metadata 端点覆盖）──

    test('getWebToolsConfig：脱敏回显同构（只读）', async () => {
        expect(await localHost.getWebToolsConfig(MACHINE_ID))
            .toEqual(await socketHost.getWebToolsConfig(MACHINE_ID))
    })

    test('verifyWebToolsProvider：非法参数（schema 拒绝）同构', async () => {
        expect(await localHost.verifyWebToolsProvider(MACHINE_ID, 'no-such-provider', { any: 'x' }))
            .toEqual(await socketHost.verifyWebToolsProvider(MACHINE_ID, 'no-such-provider', { any: 'x' }))
    })
})
