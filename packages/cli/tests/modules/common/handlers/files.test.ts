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
import { mkdtemp, rm, stat, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager'
import { registerFileHandlers } from '@/modules/common/handlers/files'

/**
 * files handler 测试（readFileMeta / readFileRange）
 *
 * 使用真实 RpcHandlerManager + handleRequest，验证完整注册链路；
 * readFileRange 测试断言真实字节内容（非 mock）。
 */

const SCOPE = 'session-files-test'

describe('file RPC handlers', () => {
    let rootDir: string
    let rpc: RpcHandlerManager

    beforeEach(async () => {
        // 兜底：上一个 it 若抛异常，afterEach 可能没跑，这里先清残留再建新目录
        if (rootDir) {
            await rm(rootDir, { recursive: true, force: true })
        }
        rootDir = await mkdtemp(join(tmpdir(), 'mobi-files-'))
        rpc = new RpcHandlerManager({ scopePrefix: SCOPE })
        registerFileHandlers(rpc, rootDir)
    })

    afterEach(async () => {
        if (rootDir) {
            await rm(rootDir, { recursive: true, force: true })
        }
    })

    describe('readFileMeta', () => {
        it('返回 mime/size/etag', async () => {
            await writeFile(join(rootDir, 'a.txt'), 'hello world')

            const r = (await rpc.handleRequest({
                method: `${SCOPE}:readFileMeta`,
                params: { path: 'a.txt' },
            })) as { success: boolean; meta?: { mime: string; size: number; etag: string } }

            expect(r.success).toBe(true)
            expect(r.meta?.mime).toBe('text/plain')
            expect(r.meta?.size).toBe(11)
            expect(typeof r.meta?.etag).toBe('string')
        })

        it('未知扩展名 → application/octet-stream', async () => {
            await writeFile(join(rootDir, 'weird.xyz'), 'x')
            const r = (await rpc.handleRequest({
                method: `${SCOPE}:readFileMeta`,
                params: { path: 'weird.xyz' },
            })) as { success: boolean; meta?: { mime: string } }
            expect(r.meta?.mime).toBe('application/octet-stream')
        })

        it('路径越权 → 失败', async () => {
            const r = (await rpc.handleRequest({
                method: `${SCOPE}:readFileMeta`,
                params: { path: '../../../etc/passwd' },
            })) as { success: boolean }
            expect(r.success).toBe(false)
        })
    })

    describe('读边界放宽（ADR 0004：cwd ∪ home−黑名单）', () => {
        let homeDir: string
        let rpc2: RpcHandlerManager
        const SCOPE2 = 'read-boundary-test'

        beforeEach(async () => {
            homeDir = await mkdtemp(join(tmpdir(), 'mobi-home-'))
            rpc2 = new RpcHandlerManager({ scopePrefix: SCOPE2 })
            registerFileHandlers(rpc2, rootDir, homeDir)
        })
        afterEach(async () => {
            await rm(homeDir, { recursive: true, force: true })
        })

        it('~ 路径（home 通道）meta 可读：expand 后 stat 到真实文件', async () => {
            await writeFile(join(homeDir, 'note.md'), 'E2E home note')
            const r = (await rpc2.handleRequest({
                method: `${SCOPE2}:readFileMeta`,
                params: { path: '~/note.md' },
            })) as { success: boolean; error?: string }
            expect(r.success).toBe(true)
        })

        it('黑名单目录（home 直接子级 .ssh）拒绝', async () => {
            const r = (await rpc2.handleRequest({
                method: `${SCOPE2}:readFileMeta`,
                params: { path: '~/.ssh/id_rsa' },
            })) as { success: boolean; error?: string; code?: string }
            expect(r.success).toBe(false)
            expect(r.error).toContain('protected directory')
            // 结构化码随响应透出，hub 据此映射 403（web 端展示真实原因而非笼统 500）
            expect(r.code).toBe('ACCESS_DENIED')
        })

        it('cwd 内 .mobi/uploads 不受黑名单影响（黑名单只匹配 home 直接子级）', async () => {
            const dir = join(rootDir, '.mobi', 'uploads')
            const fs = await import('fs/promises')
            await fs.mkdir(dir, { recursive: true })
            await writeFile(join(dir, 'a.pdf'), 'x')
            const r = (await rpc2.handleRequest({
                method: `${SCOPE2}:readFileMeta`,
                params: { path: '.mobi/uploads/a.pdf' },
            })) as { success: boolean }
            expect(r.success).toBe(true)
        })

        it('writable 判定：~ 路径=false（cwd/~/x 不误判），cwd 内=true', async () => {
            // 回归：writableOf 未展开 ~ 时，~/x 被 resolve 成 cwd/~/x 误判 writable=true
            await writeFile(join(homeDir, 'note.md'), 'hello')
            const r = (await rpc2.handleRequest({
                method: `${SCOPE2}:readFileMeta`,
                params: { path: '~/note.md' },
            })) as { success: boolean; writable?: boolean }
            expect(r.success).toBe(true)
            expect(r.writable).toBe(false)

            await writeFile(join(rootDir, 'a.txt'), 'hello')
            const r2 = (await rpc2.handleRequest({
                method: `${SCOPE2}:readFileMeta`,
                params: { path: 'a.txt' },
            })) as { success: boolean; writable?: boolean }
            expect(r2.writable).toBe(true)
        })

        it('writeFile 写边界：~ 路径拒绝（写与 writable 同源 validateWritePath）', async () => {
            // 回归：旧 validatePath 不展开 ~，~/evil 被 resolve 成字面 cwd/~/evil（在 cwd 内）
            // 放行并真实写入项目内的字面 ~ 目录——与 writable 判定（false）自相矛盾
            const r = (await rpc2.handleRequest({
                method: `${SCOPE2}:writeFile`,
                params: { path: '~/evil.md', content: Buffer.from('x').toString('base64') },
            })) as { success: boolean; error?: string }
            expect(r.success).toBe(false)
            expect(r.error).toContain('outside the working directory')
            // 关键：字面 cwd/~/evil.md 不得被创建
            await expect(stat(join(rootDir, '~', 'evil.md'))).rejects.toMatchObject({ code: 'ENOENT' })
        })

        it('saveFile 写边界：~ 路径拒绝（不落字面 cwd/~ 目录）', async () => {
            await writeFile(join(homeDir, 'note.md'), 'hello')
            const r = (await rpc2.handleRequest({
                method: `${SCOPE2}:saveFile`,
                params: { path: '~/note.md', content: new Uint8Array([120]), baseEtag: '' },
            })) as { success: boolean; error?: string }
            expect(r.success).toBe(false)
            expect(r.error).toContain('outside the working directory')
            await expect(stat(join(rootDir, '~', 'note.md'))).rejects.toMatchObject({ code: 'ENOENT' })
        })

        it('readFileRange 走同一读边界（~ 路径读字节）', async () => {
            await writeFile(join(homeDir, 'bin.dat'), 'abcdef')
            const r = (await rpc2.handleRequest({
                method: `${SCOPE2}:readFileRange`,
                params: { path: '~/bin.dat', offset: 0, length: 3 },
            })) as { success: boolean; chunk?: Uint8Array }
            expect(r.success).toBe(true)
            expect(Array.from(r.chunk ?? [])).toEqual([97, 98, 99])
        })
    })

    describe('readFileRange', () => {
        it('读取指定 [offset, offset+length) 段，字节正确', async () => {
            await writeFile(join(rootDir, 'b.bin'), Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]))

            const r = (await rpc.handleRequest({
                method: `${SCOPE}:readFileRange`,
                params: { path: 'b.bin', offset: 3, length: 4 },
            })) as { success: boolean; chunk?: Uint8Array }

            expect(r.success).toBe(true)
            expect(Array.from(r.chunk ?? [])).toEqual([3, 4, 5, 6])
        })

        it('offset=0 读首段；末段自动 clamp 到文件末尾', async () => {
            await writeFile(join(rootDir, 'c.txt'), 'abcdef')

            const r = (await rpc.handleRequest({
                method: `${SCOPE}:readFileRange`,
                params: { path: 'c.txt', offset: 0, length: 100 },
            })) as { success: boolean; chunk?: Uint8Array }

            const text = Array.from(r.chunk ?? [])
                .map((b) => String.fromCharCode(b))
                .join('')
            expect(text).toBe('abcdef')
        })

        it('offset 超出文件大小 → 失败', async () => {
            await writeFile(join(rootDir, 'd.txt'), 'ab')

            const r = (await rpc.handleRequest({
                method: `${SCOPE}:readFileRange`,
                params: { path: 'd.txt', offset: 10, length: 5 },
            })) as { success: boolean }

            expect(r.success).toBe(false)
        })

        it('offset 为 NaN → 失败（不绕过越界检查）', async () => {
            await writeFile(join(rootDir, 'e.txt'), 'abc')

            const r = (await rpc.handleRequest({
                method: `${SCOPE}:readFileRange`,
                params: { path: 'e.txt', offset: NaN, length: 2 },
            })) as { success: boolean }

            expect(r.success).toBe(false)
        })
    })
})
