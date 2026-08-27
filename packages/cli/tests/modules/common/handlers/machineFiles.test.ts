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

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { basename, join } from 'path'
import { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager'
import { registerMachineFileHandlers } from '@/modules/common/handlers/machineFiles'

/**
 * machine 通道文件读取 handler 测试
 *
 * 使用真实 RpcHandlerManager + handleRequest，验证完整注册链路；
 * 策略断言：严格 cwd 边界（../ 逃逸 / 同前缀兄弟目录）+ 扩展名白名单。
 */

const SCOPE = 'machine-files-test'

describe('machine file RPC handlers', () => {
    let rootDir: string
    let rpc: RpcHandlerManager

    beforeEach(async () => {
        if (rootDir) {
            await rm(rootDir, { recursive: true, force: true })
        }
        rootDir = await mkdtemp(join(tmpdir(), 'mobi-machine-files-'))
        rpc = new RpcHandlerManager({ scopePrefix: SCOPE })
        registerMachineFileHandlers(rpc)
    })

    afterEach(async () => {
        await rm(rootDir, { recursive: true, force: true })
    })

    function handleMeta(params: Record<string, unknown>) {
        return rpc.handleRequest({
            method: `${SCOPE}:readFileMeta`,
            params,
        }) as Promise<{ success: boolean; meta?: { mime: string; size: number; etag: string }; error?: string; code?: string }>
    }

    describe('cwd 边界', () => {
        it('cwd 内白名单文件 → meta', async () => {
            await writeFile(join(rootDir, 'pic.png'), Buffer.from([0x89, 0x50]))
            const r = await handleMeta({ path: 'pic.png', cwd: rootDir })
            expect(r.success).toBe(true)
            expect(r.meta?.mime).toBe('image/png')
            expect(r.meta?.size).toBe(2)
            expect(typeof r.meta?.etag).toBe('string')
        })

        it('缺省 cwd 回退 process.cwd()，越界文件 → 失败', async () => {
            // rootDir 在 tmpdir 下，相对 handler 缺省边界（process.cwd()）必然逃逸
            const r = await handleMeta({ path: join(rootDir, 'a.js') })
            expect(r.success).toBe(false)
        })

        it('显式 cwd 的绝对路径白名单内文件 → 通过', async () => {
            await writeFile(join(rootDir, 'b.html'), '<p/>')
            const r = await handleMeta({ path: join(rootDir, 'b.html'), cwd: rootDir })
            expect(r.success).toBe(true)
        })

        it('../ 逃逸 → 失败', async () => {
            const outside = await mkdtemp(join(tmpdir(), 'mobi-outside-'))
            try {
                await writeFile(join(outside, 'secret.png'), 'p')
                const r = await handleMeta({ path: '../' + basename(outside) + '/secret.png', cwd: rootDir })
                expect(r.success).toBe(false)
            } finally {
                await rm(outside, { recursive: true, force: true })
            }
        })

        it('同前缀兄弟目录 → 失败（防 startsWith 式误判）', async () => {
            const sibling = rootDir + '-sibling'
            await mkdir(sibling, { recursive: true })
            try {
                await writeFile(join(sibling, 's.png'), 'x')
                // ../<basename>-sibling/... ：resolve 后落在兄弟目录，relative 判定必拒
                const r = await handleMeta({ path: '../' + basename(sibling) + '/s.png', cwd: rootDir })
                expect(r.success).toBe(false)
            } finally {
                await rm(sibling, { recursive: true, force: true })
            }
        })
    })

    describe('扩展名白名单', () => {
        it.each(['a.html', 'b.js', 'c.css', 'd.webp', 'e.svg'])('%s 放行', async (name) => {
            await writeFile(join(rootDir, name), 'x')
            const r = await handleMeta({ path: name, cwd: rootDir })
            expect(r.success).toBe(true)
        })

        it.each(['note.txt', 'app.py', 'data.json'])('%s 拒绝且带 EXT_FORBIDDEN 码', async (name) => {
            await writeFile(join(rootDir, name), 'x')
            const r = await handleMeta({ path: name, cwd: rootDir })
            expect(r.success).toBe(false)
            expect(r.code).toBe('EXT_FORBIDDEN')
        })

        it('无扩展名拒绝', async () => {
            await writeFile(join(rootDir, 'noext'), 'x')
            const r = await handleMeta({ path: 'noext', cwd: rootDir })
            expect(r.success).toBe(false)
            expect(r.code).toBe('EXT_FORBIDDEN')
        })
    })

    describe('ENOENT 结构化透传', () => {
        it('不存在的白名单文件 → code=ENOENT（hub 据此映射 404）', async () => {
            const r = await handleMeta({ path: 'ghost.png', cwd: rootDir })
            expect(r.success).toBe(false)
            expect(r.code).toBe('ENOENT')
        })
    })

    describe('machine readFileRange', () => {
        it('返回真实字节', async () => {
            const body = Buffer.from('console.log(1)')
            await writeFile(join(rootDir, 'm.js'), body)
            const r = (await rpc.handleRequest({
                method: `${SCOPE}:readFileRange`,
                params: { path: 'm.js', cwd: rootDir, offset: 0, length: body.length },
            })) as { success: boolean; chunk?: Uint8Array }
            expect(r.success).toBe(true)
            expect(Buffer.from(r.chunk!).toString()).toBe('console.log(1)')
        })

        it('非白名单不读字节', async () => {
            await writeFile(join(rootDir, 'n.txt'), 'x')
            const r = (await rpc.handleRequest({
                method: `${SCOPE}:readFileRange`,
                params: { path: 'n.txt', cwd: rootDir, offset: 0, length: 1 },
            })) as { success: boolean }
            expect(r.success).toBe(false)
        })

        it('meta 后文件被删除：ENOENT 结构化码透传（与 meta 对齐）', async () => {
            const r = (await rpc.handleRequest({
                method: `${SCOPE}:readFileRange`,
                params: { path: 'gone.png', cwd: rootDir, offset: 0, length: 1 },
            })) as { success: boolean; code?: string }
            expect(r.success).toBe(false)
            expect(r.code).toBe('ENOENT')
        })
    })
})
