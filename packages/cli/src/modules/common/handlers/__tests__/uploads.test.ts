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

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join, resolve, relative } from 'path'
import { existsSync, readFileSync, rmSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { getAttachmentsDir } from '@/constants/uploadPaths'
import type { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager'
import { registerUploadHandlers } from '../uploads'

/**
 * uploads handler 测试
 *
 * 验证：
 * - getAttachmentsDir 返回正确路径
 * - uploadFile 存储到 .mobi/attachments/YYYY-MM/
 * - .mobi/.gitignore 自动创建且内容为 "attachments/"
 * - 黑名单文件类型被拒绝
 * - 文件名清理（移除 .. 和 /）
 * - 返回项目相对路径
 */

// 模拟的 RpcHandlerManager，用于测试
class MockRpcHandlerManager {
    handlers = new Map<string, (data: any) => any>()

    registerHandler<TReq, TRes>(
        method: string,
        handler: (data: TReq) => TRes | Promise<TRes>,
    ): void {
        this.handlers.set(method, handler)
    }

    async call(method: string, data: any): Promise<any> {
        const handler = this.handlers.get(method)
        if (!handler) {
            throw new Error(`No handler registered for method: ${method}`)
        }
        return handler(data)
    }
}

/**
 * 创建 base64 编码内容
 */
function toBase64(content: string): string {
    return Buffer.from(content).toString('base64')
}

describe('getAttachmentsDir', () => {
    it('应返回 projectRoot/.mobi/attachments 路径', () => {
        const projectRoot = '/tmp/test-project'
        const result = getAttachmentsDir(projectRoot)
        expect(result).toBe(join(projectRoot, '.mobi', 'attachments'))
    })

    it('不同 projectRoot 应返回不同路径', () => {
        const result1 = getAttachmentsDir('/project/a')
        const result2 = getAttachmentsDir('/project/b')
        expect(result1).toBe(join('/project/a', '.mobi', 'attachments'))
        expect(result2).toBe(join('/project/b', '.mobi', 'attachments'))
        expect(result1).not.toBe(result2)
    })
})

describe('uploadFile handler', () => {
    let mockRpc: MockRpcHandlerManager
    let tempDir: string

    beforeEach(() => {
        mockRpc = new MockRpcHandlerManager()
        // 每个测试使用独立的临时目录作为项目根目录
        tempDir = join(tmpdir(), `mobi-test-uploads-${Date.now()}-${Math.random().toString(36).slice(2)}`)
        mkdirSync(tempDir, { recursive: true })
        registerUploadHandlers(mockRpc as unknown as RpcHandlerManager, tempDir)
    })

    afterEach(() => {
        // 清理临时目录
        if (existsSync(tempDir)) {
            rmSync(tempDir, { recursive: true, force: true })
        }
    })

    it('应将文件存储到 .mobi/attachments/YYYY-MM/ 目录', async () => {
        const result = await mockRpc.call('uploadFile', {
            filename: 'test.png',
            content: toBase64('hello world'),
            mimeType: 'image/png',
        })

        expect(result.success).toBe(true)
        expect(result.path).toBeTruthy()

        // 验证返回的是相对路径
        const fullPath = resolve(tempDir, result.path)
        expect(existsSync(fullPath)).toBe(true)

        // 验证路径结构包含 .mobi/attachments/YYYY-MM
        expect(result.path).toMatch(/\.mobi\/attachments\/\d{4}-\d{2}\//)

        // 验证文件内容
        const content = readFileSync(fullPath)
        expect(content.toString()).toBe('hello world')
    })

    it('应自动创建 .mobi/.gitignore 且内容为 "attachments/"', async () => {
        await mockRpc.call('uploadFile', {
            filename: 'test.png',
            content: toBase64('hello'),
            mimeType: 'image/png',
        })

        const gitignorePath = join(tempDir, '.mobi', '.gitignore')
        expect(existsSync(gitignorePath)).toBe(true)

        const content = readFileSync(gitignorePath, 'utf-8')
        expect(content.trim()).toBe('attachments/')
    })

    it('应返回项目相对路径', async () => {
        const result = await mockRpc.call('uploadFile', {
            filename: 'doc.pdf',
            content: toBase64('pdf content'),
            mimeType: 'application/pdf',
        })

        expect(result.success).toBe(true)
        expect(result.path).toBeTruthy()

        // 不应该以 / 开头（相对路径）
        expect(result.path).not.toMatch(/^\//)

        // 解析后应该等于实际文件路径
        const fullPath = resolve(tempDir, result.path)
        expect(existsSync(fullPath)).toBe(true)
    })

    it('应清理文件名中的 .. 和 /', async () => {
        const result = await mockRpc.call('uploadFile', {
            filename: '../../../etc/test.png',
            content: toBase64('hack'),
            mimeType: 'image/png',
        })

        expect(result.success).toBe(true)

        // 文件名中不应包含 .. 或原始路径分隔符
        const fullPath = resolve(tempDir, result.path)
        // 验证文件确实在 attachments 目录内
        expect(fullPath).toContain('.mobi/attachments')

        // 验证没有路径遍历
        const attachmentsDir = join(tempDir, '.mobi', 'attachments')
        expect(fullPath.startsWith(attachmentsDir)).toBe(true)
    })

    it('应拒绝黑名单文件类型（可执行文件）', async () => {
        const blockedExtensions = ['.exe', '.bat', '.cmd', '.com', '.vbs', '.ps1']

        for (const ext of blockedExtensions) {
            const result = await mockRpc.call('uploadFile', {
                filename: `malware${ext}`,
                content: toBase64('evil code'),
                mimeType: 'application/octet-stream',
            })
            expect(result.success).toBe(false)
            expect(result.error).toBeTruthy()
        }
    })

    it('应拒绝没有文件名的请求', async () => {
        const result = await mockRpc.call('uploadFile', {
            filename: '',
            content: toBase64('content'),
            mimeType: 'text/plain',
        })

        expect(result.success).toBe(false)
        expect(result.error).toContain('Filename')
    })

    it('应拒绝没有内容的请求', async () => {
        const result = await mockRpc.call('uploadFile', {
            filename: 'test.png',
            content: '',
            mimeType: 'image/png',
        })

        expect(result.success).toBe(false)
        expect(result.error).toContain('Content')
    })

    it('应拒绝超大文件', async () => {
        // 创建超过 50MB 的内容（通过 base64 估算）
        const result = await mockRpc.call('uploadFile', {
            filename: 'big.png',
            content: 'A'.repeat(70 * 1024 * 1024), // 70MB base64 > 50MB
            mimeType: 'image/png',
        })

        expect(result.success).toBe(false)
        expect(result.error).toContain('large')
    })

    it('应接受白名单中的文件类型', async () => {
        const allowedTypes = [
            { filename: 'photo.jpg', mimeType: 'image/jpeg' },
            { filename: 'doc.pdf', mimeType: 'application/pdf' },
            { filename: 'code.py', mimeType: 'text/x-python' },
            { filename: 'archive.zip', mimeType: 'application/zip' },
        ]

        for (const { filename, mimeType } of allowedTypes) {
            const result = await mockRpc.call('uploadFile', {
                filename,
                content: toBase64('test content'),
                mimeType,
            })
            expect(result.success).toBe(true)
        }
    })

    it('应拒绝无扩展名的文件', async () => {
        const result = await mockRpc.call('uploadFile', {
            filename: 'noextension',
            content: toBase64('content'),
            mimeType: 'text/plain',
        })

        expect(result.success).toBe(false)
        expect(result.error).toBeTruthy()
    })

    it('同一月内多次上传应存入同一目录', async () => {
        const result1 = await mockRpc.call('uploadFile', {
            filename: 'file1.png',
            content: toBase64('content1'),
            mimeType: 'image/png',
        })

        const result2 = await mockRpc.call('uploadFile', {
            filename: 'file2.png',
            content: toBase64('content2'),
            mimeType: 'image/png',
        })

        expect(result1.success).toBe(true)
        expect(result2.success).toBe(true)

        // 两个文件应该在同一个 YYYY-MM 目录
        const dir1 = result1.path.split('/').slice(0, 3).join('/')
        const dir2 = result2.path.split('/').slice(0, 3).join('/')
        expect(dir1).toBe(dir2)
    })
})

describe('deleteUpload handler', () => {
    let mockRpc: MockRpcHandlerManager
    let tempDir: string

    beforeEach(() => {
        mockRpc = new MockRpcHandlerManager()
        tempDir = join(tmpdir(), `mobi-test-delete-${Date.now()}-${Math.random().toString(36).slice(2)}`)
        mkdirSync(tempDir, { recursive: true })
        registerUploadHandlers(mockRpc as unknown as RpcHandlerManager, tempDir)
    })

    afterEach(() => {
        if (existsSync(tempDir)) {
            rmSync(tempDir, { recursive: true, force: true })
        }
    })

    it('应能删除已上传的文件', async () => {
        const uploadResult = await mockRpc.call('uploadFile', {
            filename: 'to-delete.png',
            content: toBase64('delete me'),
            mimeType: 'image/png',
        })

        expect(uploadResult.success).toBe(true)
        const fullPath = resolve(tempDir, uploadResult.path)
        expect(existsSync(fullPath)).toBe(true)

        // 删除
        const deleteResult = await mockRpc.call('deleteUpload', {
            path: uploadResult.path,
        })

        expect(deleteResult.success).toBe(true)
        expect(existsSync(fullPath)).toBe(false)
    })

    it('应拒绝不在 attachments 目录内的路径', async () => {
        const result = await mockRpc.call('deleteUpload', {
            path: '../../../etc/passwd',
        })

        expect(result.success).toBe(false)
        expect(result.error).toContain('Invalid')
    })

    it('应拒绝绝对路径', async () => {
        const result = await mockRpc.call('deleteUpload', {
            path: '/etc/passwd',
        })

        expect(result.success).toBe(false)
    })

    it('应拒绝空路径', async () => {
        const result = await mockRpc.call('deleteUpload', {
            path: '',
        })

        expect(result.success).toBe(false)
    })
})
