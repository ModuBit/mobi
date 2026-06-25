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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import type { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager'

/**
 * 首块孤儿清理专项测试。
 *
 * 部分模拟 fs/promises：仅劫持 open，让首块 fd.write 抛错（模拟磁盘满 / EIO），
 * 其余（mkdir / rm / stat / writeFile / readFile）保持真实 ——
 * 这样 open('w') 真实落盘文件，write 失败后可验证 rm 真实删除孤儿文件。
 *
 * 独立文件以隔离 vi.mock（避免影响 uploads.test.ts 的真实 fs 测试）。
 */
vi.mock('fs/promises', async (importOriginal) => {
    const actual = await importOriginal() as typeof import('fs/promises')
    return {
        ...actual,
        open: vi.fn(async (path: unknown, flags: unknown) => {
            const fd = await actual.open(
                path as Parameters<typeof actual.open>[0],
                flags as Parameters<typeof actual.open>[1],
            )
            // 劫持 write：抛错模拟磁盘满，触发首块孤儿清理分支
            ;(fd as { write: unknown }).write = async () => {
                throw new Error('disk full (mock)')
            }
            return fd
        }),
    }
})

const { registerUploadHandlers } = await import('@/modules/common/handlers/uploads')

interface MockHandlerResult {
    success: boolean
    path?: string
    written?: number
    error?: string
}

class MockRpcHandlerManager {
    handlers = new Map<string, (data: unknown) => unknown>()

    registerHandler<TReq, TRes>(
        method: string,
        handler: (data: TReq) => TRes | Promise<TRes>,
    ): void {
        this.handlers.set(method, handler as (data: unknown) => unknown)
    }

    async call(method: string, data: unknown): Promise<MockHandlerResult> {
        const handler = this.handlers.get(method)
        if (!handler) throw new Error(`No handler registered for: ${method}`)
        return Promise.resolve(handler(data)).then((r) => r as MockHandlerResult)
    }
}

describe('writeFileRange 首块孤儿清理', () => {
    let mockRpc: MockRpcHandlerManager
    let tempDir: string

    beforeEach(() => {
        mockRpc = new MockRpcHandlerManager()
        tempDir = join(tmpdir(), `mobi-test-orphan-${Date.now()}-${Math.random().toString(36).slice(2)}`)
        mkdirSync(tempDir, { recursive: true })
        registerUploadHandlers(mockRpc as unknown as RpcHandlerManager, tempDir)
    })

    afterEach(() => {
        if (existsSync(tempDir)) {
            rmSync(tempDir, { recursive: true, force: true })
        }
    })

    it('首块 write 失败 → 清理孤儿文件并返回错误（不泄漏空 / 半成品文件）', async () => {
        const res = await mockRpc.call('writeFileRange', {
            filename: 'orphan.png',
            offset: 0,
            content: new Uint8Array([1, 2, 3]),
            totalSize: 3,
        })

        // write 抛错 → 返回 rpcError（不返回 path）
        expect(res.success).toBe(false)
        expect(res.path).toBeUndefined()

        // open('w') 已创建文件，write 失败后应被 rm 清理 → 当月 uploads 目录无残留
        const now = new Date()
        const monthDir = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
        const uploadsDir = resolve(tempDir, '.mobi', 'uploads', monthDir)
        const leftover = existsSync(uploadsDir) ? readdirSync(uploadsDir) : []
        expect(leftover).toEqual([])
    })
})
