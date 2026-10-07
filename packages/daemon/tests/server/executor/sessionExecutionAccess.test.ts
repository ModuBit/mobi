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

import { describe, test, expect } from 'bun:test'
import { SessionExecutionAccess } from '../../../src/executor/sessionExecutionAccess'
import type { ExecutorHost } from '../../../src/executor/executorHost'
import { Store } from '../../../src/store'

/**
 * 会话执行访问 module 的测试面 = 它自己的接口：cwd 注入寻址 + host 族纯转发。
 * 断言只锁「寻址正确 + 业务参数透传」（换实现方式后仍应成立），
 * 不锁 ExecutorHost 内部（那是执行层自己的测试）。
 */

/** 捕获型执行层 fake：host 族调用记为 { method, args }，返回固定信封 */
function makeHarness() {
    const calls: { method: string; args: unknown[] }[] = []
    const rec = (method: string) => (...args: unknown[]) => {
        calls.push({ method, args })
        return { ok: true }
    }
    const executor = {
        hostReadFileMeta: rec('hostReadFileMeta'),
        hostReadFileRange: rec('hostReadFileRange'),
        hostSaveFile: rec('hostSaveFile'),
        hostUploadFileRange: rec('hostUploadFileRange'),
        hostDeleteUpload: rec('hostDeleteUpload'),
        hostReplaceUpload: rec('hostReplaceUpload'),
        hostSearchFiles: rec('hostSearchFiles'),
        hostListSessionDirectory: rec('hostListSessionDirectory'),
        hostGitReviewOverview: rec('hostGitReviewOverview'),
        checkPathsExist: rec('checkPathsExist'),
        getWebToolsConfig: rec('getWebToolsConfig'),
    } as unknown as ExecutorHost
    const store = new Store(':memory:')
    const access = new SessionExecutionAccess(store, executor)
    /** 建 session 行并返回 id（metadata 带 path 即 cwd 锚） */
    const seed = (metadata: Record<string, unknown> = { path: '/tmp/proj' }) =>
        store.sessions.getOrCreateSession(`tag-exec-access-${Math.random().toString(36).slice(2)}`, metadata, null, 'default').id
    return { access, calls, seed }
}

describe('SessionExecutionAccess：session 寻址族（cwd 注入）', () => {
    test('readFileMeta / readFileRange 注入 cwd 并透传业务参数', async () => {
        const { access, calls, seed } = makeHarness()
        const sid = seed()

        await access.readFileMeta(sid, 'a.txt')
        await access.readFileRange(sid, 'a.txt', 5, 100)

        expect(calls).toEqual([
            { method: 'hostReadFileMeta', args: ['/tmp/proj', 'a.txt'] },
            { method: 'hostReadFileRange', args: ['/tmp/proj', 'a.txt', 5, 100] },
        ])
    })

    test('searchSessionFiles / listSessionDirectory 透传 type / prefix', async () => {
        const { access, calls, seed } = makeHarness()
        const sid = seed()

        await access.searchSessionFiles(sid, 'hub', 'file')
        await access.listSessionDirectory(sid, 'docs', 'hu')

        expect(calls).toEqual([
            { method: 'hostSearchFiles', args: ['/tmp/proj', 'hub', 'file'] },
            { method: 'hostListSessionDirectory', args: ['/tmp/proj', 'docs', 'hu'] },
        ])
    })

    test('uploadFileRange 透传分片全参（filename/path/offset/content/totalSize）', async () => {
        const { access, calls, seed } = makeHarness()
        const sid = seed()
        const chunk = new Uint8Array([1, 2, 3])

        await access.uploadFileRange(sid, 'f.png', undefined, 0, chunk, 3)

        expect(calls[0].method).toBe('hostUploadFileRange')
        const [cwd, filename, path, offset, content, totalSize] = calls[0].args
        expect(cwd).toBe('/tmp/proj')
        expect(filename).toBe('f.png')
        expect(path).toBeUndefined()
        expect(offset).toBe(0)
        expect(content).toBe(chunk)
        expect(totalSize).toBe(3)
    })

    test('deleteUploadFile / replaceUploadFile 注入 cwd', async () => {
        const { access, calls, seed } = makeHarness()
        const sid = seed()

        await access.deleteUploadFile(sid, '.mobi/uploads/a.png')
        await access.replaceUploadFile(sid, '.mobi/uploads/a.png', new Uint8Array([9]))

        expect(calls[0]).toEqual({ method: 'hostDeleteUpload', args: ['/tmp/proj', '.mobi/uploads/a.png'] })
        expect(calls[1].method).toBe('hostReplaceUpload')
        expect(calls[1].args.slice(0, 2)).toEqual(['/tmp/proj', '.mobi/uploads/a.png'])
    })

    test('saveFile 注入 cwd（冷编辑器：改文件不唤醒会话）', async () => {
        const { access, calls, seed } = makeHarness()
        const sid = seed()
        const content = new Uint8Array([1])

        await access.saveFile(sid, 'a.txt', content, '1-1')

        expect(calls).toEqual([{ method: 'hostSaveFile', args: ['/tmp/proj', 'a.txt', content, '1-1'] }])
    })

    test('gitReviewOverview 注入 cwd 且透传 sessionId', async () => {
        const { access, calls, seed } = makeHarness()
        const sid = seed()

        await access.gitReviewOverview(sid)

        expect(calls).toEqual([{ method: 'hostGitReviewOverview', args: ['/tmp/proj', sid] }])
    })
})

describe('SessionExecutionAccess：寻址失败语义（ADR 0006）', () => {
    test('cwd 缺失显式报错，不回退 session socket，且不触执行层', async () => {
        const { access, calls, seed } = makeHarness()
        const sid = seed({ host: 'h' })

        await expect(access.readFileMeta(sid, 'a.txt')).rejects.toThrow(/cwd/i)
        expect(calls).toEqual([])
    })

    test('会话行不存在 → Session not found（与 cwd 缺失可分辨）', async () => {
        const { access } = makeHarness()

        await expect(access.readFileMeta('ghost-session', 'a.txt')).rejects.toThrow(/Session not found/)
    })

    test('tryResolveCwd 宽松寻址：行不存在 / cwd 缺失均返回 null（不抛）', () => {
        const { access, seed } = makeHarness()
        const sid = seed({ host: 'h' })

        expect(access.tryResolveCwd(sid)).toBeNull()
        expect(access.tryResolveCwd('ghost-session')).toBeNull()
    })
})

describe('SessionExecutionAccess：host 直调族 / 配置族（纯转发）', () => {
    test('checkPathsExist / getWebToolsConfig 无寻址直转发', async () => {
        const { access, calls } = makeHarness()

        await access.checkPathsExist(['/a', '/b'])
        await access.getWebToolsConfig()

        expect(calls).toEqual([
            { method: 'checkPathsExist', args: [['/a', '/b']] },
            { method: 'getWebToolsConfig', args: [] },
        ])
    })
})
