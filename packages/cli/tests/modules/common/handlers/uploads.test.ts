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
import { mkdtemp, rm, readFile, stat } from 'fs/promises'
import { existsSync, mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import type { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager'
import { registerUploadHandlers } from '@/modules/common/handlers/uploads'
import { MAX_UPLOAD_BYTES } from '@mobi/shared/upload'

/**
 * uploads handler 测试
 *
 * 验证：
 * - writeFileRange：offset=0 首块创建文件 + offset>0 后续块追加
 * - writeFileRange：totalSize 预校验、累计超限兜底、扩展名/path 遍历防护
 * - deleteUpload：路径校验 + 删除
 * - getUploadsDir：返回正确路径
 */

// 测试用的 handler 返回结构（write/delete 共用 success/path/written/error 字段）
interface MockHandlerResult {
    success: boolean
    path?: string
    written?: number
    error?: string
}

// 模拟的 RpcHandlerManager，用于测试
class MockRpcHandlerManager {
    handlers = new Map<string, (data: unknown) => unknown>()

    registerHandler<TReq, TRes>(
        method: string,
        handler: (data: TReq) => TRes | Promise<TRes>,
    ): void {
        // 测试 mock：异构 handler 存入同一 Map，擦除泛型
        this.handlers.set(method, handler as (data: unknown) => unknown)
    }

    async call(method: string, data: unknown): Promise<MockHandlerResult> {
        const handler = this.handlers.get(method)
        if (!handler) {
            throw new Error(`No handler registered for method: ${method}`)
        }
        return Promise.resolve(handler(data)).then((r) => r as MockHandlerResult)
    }
}

describe('writeFileRange handler', () => {
    let mockRpc: MockRpcHandlerManager
    let tempDir: string

    beforeEach(() => {
        mockRpc = new MockRpcHandlerManager()
        tempDir = join(tmpdir(), `mobi-test-wfr-${Date.now()}-${Math.random().toString(36).slice(2)}`)
        mkdirSync(tempDir, { recursive: true })
        registerUploadHandlers(mockRpc as unknown as RpcHandlerManager, tempDir)
    })

    afterEach(() => {
        if (existsSync(tempDir)) {
            rmSync(tempDir, { recursive: true, force: true })
        }
    })

    it('offset=0 首块：创建文件 + 返回 path/written', async () => {
        const content = new Uint8Array([1, 2, 3, 4])
        const res = await mockRpc.call('writeFileRange', {
            filename: 'test.png', offset: 0, content, totalSize: 4,
        })

        expect(res.success).toBe(true)
        expect(res.written).toBe(4)
        expect(res.path).toMatch(/\.mobi\/uploads\/\d{4}-\d{2}\/test-.+\.png$/)

        // 验证文件内容
        const fullPath = resolve(tempDir, res.path!)
        const buf = await readFile(fullPath)
        expect(Array.from(buf)).toEqual([1, 2, 3, 4])
    })

    it('offset>0 后续块：按 offset 追加写，内容拼接正确', async () => {
        const first = await mockRpc.call('writeFileRange', {
            filename: 'a.zip', offset: 0, content: new Uint8Array([1, 2]), totalSize: 4,
        })
        expect(first.success).toBe(true)
        expect(first.path).toBeTruthy()

        const res = await mockRpc.call('writeFileRange', {
            path: first.path, offset: 2, content: new Uint8Array([3, 4]),
        })

        expect(res.success).toBe(true)
        expect(res.written).toBe(2)

        const fullPath = resolve(tempDir, first.path!)
        const buf = await readFile(fullPath)
        expect(Array.from(buf)).toEqual([1, 2, 3, 4])
    })

    it('totalSize 预校验：超 50MB 首块即拒绝，不创建文件', async () => {
        const res = await mockRpc.call('writeFileRange', {
            filename: 'big.zip', offset: 0, content: new Uint8Array([1]),
            totalSize: 50 * 1024 * 1024 + 1,
        })

        expect(res.success).toBe(false)
        expect(res.error).toMatch(/too large/i)
    })

    it('扩展名校验：黑名单/非白名单拒绝', async () => {
        const res = await mockRpc.call('writeFileRange', {
            filename: 'evil.exe', offset: 0, content: new Uint8Array([1]), totalSize: 1,
        })

        expect(res.success).toBe(false)
    })

    it('path 遍历防护：后续块 path 逃逸 uploads 目录拒绝', async () => {
        const res = await mockRpc.call('writeFileRange', {
            path: '../../../etc/passwd', offset: 0, content: new Uint8Array([1]),
        })

        expect(res.success).toBe(false)
    })

    it('offset>0 但文件不存在（path 指向不存在的路径）：open r+ 失败 → rpcError', async () => {
        const first = await mockRpc.call('writeFileRange', {
            filename: 'create.zip', offset: 0, content: new Uint8Array([1, 2]), totalSize: 2,
        })
        expect(first.success).toBe(true)
        const res = await mockRpc.call('writeFileRange', {
            path: '.mobi/uploads/2099-01/nope-xxx.png', offset: 5, content: new Uint8Array([3]),
        })
        expect(res.success).toBe(false)
    })

    it('offset=0 但传 path（非 filename）：走后续块分支 → 文件不存在 rpcError', async () => {
        const res = await mockRpc.call('writeFileRange', {
            path: '.mobi/uploads/2099-01/nope.png', offset: 0, content: new Uint8Array([1]),
        })
        // 分支条件为 filename 是否存在（非 offset 是否为 0），传 path 无 filename 走后续块定位
        expect(res.success).toBe(false)
    })

    it('offset 越界：后续块 offset > 文件 size → 拒绝，不扩展稀疏文件', async () => {
        const first = await mockRpc.call('writeFileRange', {
            filename: 'no-hole.zip', offset: 0, content: new Uint8Array([1, 2, 3, 4]), totalSize: 4,
        })
        expect(first.success).toBe(true)
        const res = await mockRpc.call('writeFileRange', {
            path: first.path, offset: 9999, content: new Uint8Array([5]),
        })
        expect(res.success).toBe(false)
        expect(res.error).toMatch(/out of bounds/i)
        // 验证文件大小未扩展（无稀疏空洞）
        const fullPath = resolve(tempDir, first.path!)
        const st = await stat(fullPath)
        expect(st.size).toBe(4)
    })

    it('累计超限兜底：首块小、后续累计超 50MB → 拒绝', async () => {
        // 首块：伪造小的 totalSize 通过预校验
        const first = await mockRpc.call('writeFileRange', {
            filename: 'sneaky.zip', offset: 0,
            content: new Uint8Array(new Array(10).fill(0)),
            totalSize: 10,
        })
        expect(first.success).toBe(true)

        // 后续：写一块使累计超 50MB
        const big = new Uint8Array(MAX_UPLOAD_BYTES + 1)
        const res = await mockRpc.call('writeFileRange', {
            path: first.path, offset: 10, content: big,
        })

        expect(res.success).toBe(false)
        expect(res.error).toMatch(/too large/i)
    })
})

describe('deleteUpload handler', () => {
    let mockRpc: MockRpcHandlerManager
    let tempDir: string

    beforeEach(() => {
        mockRpc = new MockRpcHandlerManager()
        tempDir = join(tmpdir(), `mobi-test-del-${Date.now()}-${Math.random().toString(36).slice(2)}`)
        mkdirSync(tempDir, { recursive: true })
        registerUploadHandlers(mockRpc as unknown as RpcHandlerManager, tempDir)
    })

    afterEach(() => {
        if (existsSync(tempDir)) {
            rmSync(tempDir, { recursive: true, force: true })
        }
    })

    it('应能删除已上传的文件', async () => {
        const uploadResult = await mockRpc.call('writeFileRange', {
            filename: 'to-delete.png',
            offset: 0,
            content: new Uint8Array([1, 2, 3]),
            totalSize: 3,
        })

        expect(uploadResult.success).toBe(true)
        const fullPath = resolve(tempDir, uploadResult.path!)
        expect(existsSync(fullPath)).toBe(true)

        const deleteResult = await mockRpc.call('deleteUpload', { path: uploadResult.path })
        expect(deleteResult.success).toBe(true)
        expect(existsSync(fullPath)).toBe(false)
    })

    it('应拒绝不在 uploads 目录内的路径', async () => {
        const result = await mockRpc.call('deleteUpload', { path: '../../../etc/passwd' })
        expect(result.success).toBe(false)
        expect(result.error).toContain('Invalid')
    })

    it('应拒绝空路径', async () => {
        const result = await mockRpc.call('deleteUpload', { path: '' })
        expect(result.success).toBe(false)
    })
})
