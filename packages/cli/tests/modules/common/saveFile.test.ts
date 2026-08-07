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

import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdir, rm, writeFile, stat, readFile, readdir, mkdtemp } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager'
import { registerFileHandlers } from '@/modules/common/handlers/files'

// 从注册的 handler 中取出指定方法直接调用（绕过 socket，单测 handler 逻辑）
function getHandler(mgr: RpcHandlerManager, method: string) {
    // @ts-expect-error 访问私有 handlers Map 取注册的方法
    const entry = (mgr as unknown as {
        handlers: Map<string, { handler: (p: unknown) => unknown }>
    }).handlers.get(`session:${method}`)
    if (!entry) throw new Error(`handler ${method} not registered`)
    return entry.handler as (p: {
        path: string
        content: Uint8Array
        baseEtag: string
    }) => Promise<{
        success: boolean
        etag?: string
        conflict?: boolean
        currentEtag?: string
        error?: string
        code?: string
    }>
}

async function etagOf(dir: string, rel: string) {
    const st = await stat(join(dir, rel))
    return `${st.size}-${Math.floor(st.mtimeMs)}`
}

function toBytes(s: string) {
    return new TextEncoder().encode(s)
}

async function expectFile(p: string, want: string) {
    expect(await readFile(p, 'utf-8')).toBe(want)
}

describe('saveFile handler', () => {
    let dir: string
    let mgr: RpcHandlerManager

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), 'mobi-save-'))
        mgr = new RpcHandlerManager({ scopePrefix: 'session' })
        registerFileHandlers(mgr, dir)
        await writeFile(join(dir, 'a.md'), '# hello\n', 'utf-8')
    })
    afterEach(async () => {
        await rm(dir, { recursive: true, force: true })
    })

    it('baseEtag 匹配 → 原子覆盖，返回新 etag', async () => {
        const base = await etagOf(dir, 'a.md')
        const res = await getHandler(mgr, 'saveFile')({
            path: 'a.md', content: toBytes('# world\n'), baseEtag: base,
        })
        expect(res.success).toBe(true)
        expect(res.etag).toBeDefined()
        expect(res.etag).not.toBe(base)
        await expectFile(join(dir, 'a.md'), '# world\n')
    })

    it('baseEtag 不匹配（文件已被改）→ conflict，不写', async () => {
        const res = await getHandler(mgr, 'saveFile')({
            path: 'a.md', content: toBytes('# world\n'), baseEtag: 'stale-etag',
        })
        expect(res.success).toBe(false)
        expect(res.conflict).toBe(true)
        expect(res.currentEtag).toBeDefined()
        await expectFile(join(dir, 'a.md'), '# hello\n')
    })

    it('路径越权（工作目录外）→ 失败，非 conflict', async () => {
        const res = await getHandler(mgr, 'saveFile')({
            path: '../escape.md', content: toBytes('x'), baseEtag: 'x',
        })
        expect(res.success).toBe(false)
        expect(res.conflict).toBeUndefined()
    })

    it('文件不存在 → 失败 + ENOENT', async () => {
        const res = await getHandler(mgr, 'saveFile')({
            path: 'nope.md', content: toBytes('x'), baseEtag: 'x',
        })
        expect(res.success).toBe(false)
        expect(res.code).toBe('ENOENT')
    })

    it('原子写：写后无 .mobi-tmp 残留', async () => {
        const base = await etagOf(dir, 'a.md')
        await getHandler(mgr, 'saveFile')({
            path: 'a.md', content: toBytes('# x\n'), baseEtag: base,
        })
        const files = await readdir(dir)
        expect(files.filter((f) => f.includes('mobi-tmp'))).toHaveLength(0)
    })

    it('force（baseEtag=""）→ 即使 etag 不匹配也覆盖', async () => {
        const res = await getHandler(mgr, 'saveFile')({
            path: 'a.md', content: toBytes('# forced\n'), baseEtag: '',
        })
        expect(res.success).toBe(true)
        expect(res.etag).toBeDefined()
        await expectFile(join(dir, 'a.md'), '# forced\n')
    })
})
