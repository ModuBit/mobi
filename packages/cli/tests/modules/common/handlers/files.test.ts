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
import { mkdtemp, rm, writeFile } from 'fs/promises'
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
