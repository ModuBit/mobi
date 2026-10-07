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
import { mkdtemp, readFile, stat } from 'fs/promises'
import { existsSync, mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { writeFileRangeImpl, deleteUploadImpl, replaceUploadImpl, type WriteFileRangeRequest } from '@/handlers/uploads'
import { MAX_UPLOAD_BYTES } from '@mobi/shared/upload'

/**
 * uploads 实现测试
 *
 * 深化候选②票②：socket 注册退场（registerUploadHandlers 已删），writeFileRangeImpl /
 * deleteUploadImpl / replaceUploadImpl 直调。
 *
 * 验证：
 * - writeFileRange：offset=0 首块创建文件 + offset>0 后续块追加
 * - writeFileRange：totalSize 预校验、累计超限兜底、扩展名/path 遍历防护
 * - deleteUpload：路径校验 + 删除
 * - getUploadsDir：返回正确路径
 */

describe('writeFileRange 实现', () => {
    let tempDir: string

    beforeEach(() => {
        tempDir = join(tmpdir(), `mobi-test-wfr-${Date.now()}-${Math.random().toString(36).slice(2)}`)
        mkdirSync(tempDir, { recursive: true })
    })

    afterEach(() => {
        if (existsSync(tempDir)) {
            rmSync(tempDir, { recursive: true, force: true })
        }
    })

    // 深化候选②票②：socket 注册退场，writeFileRangeImpl 直调
    const writeRange = (data: WriteFileRangeRequest) => writeFileRangeImpl(data, tempDir)

    it('offset=0 首块：创建文件 + 返回 path/written', async () => {
        const content = new Uint8Array([1, 2, 3, 4])
        const res = await writeRange({
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

    it('上传就绪同时确保 .mobi/.gitignore 含 turn-diffs/（单源 mobiGitignore）', async () => {
        const res = await writeRange({
            filename: 'g.png', offset: 0, content: new Uint8Array([1]), totalSize: 1,
        })
        expect(res.success).toBe(true)
        const gitignore = await readFile(join(tempDir, '.mobi', '.gitignore'), 'utf-8')
        expect(gitignore).toContain('uploads/')
        expect(gitignore).toContain('artifacts/')
        expect(gitignore).toContain('turn-diffs/')
    })

    it('多段扩展名：防碰撞随机段插在扩展簇之前，.excalidraw.png 保持完整', async () => {
        const content = new Uint8Array([1, 2, 3])
        const res = await writeRange({
            filename: 'sketch-20260920-001516.excalidraw.png', offset: 0, content, totalSize: 3,
        })

        expect(res.success).toBe(true)
        // 不是 sketch-....excalidraw-<id>.png（extname 只认最后一段的旧行为）
        expect(res.path).toMatch(/sketch-\d{8}-\d{6}-[0-9a-z]+\.excalidraw\.png$/)
    })

    it('隐藏文件：前导点属文件名而非扩展名，唯一名不以连字符开头', async () => {
        // 可触达场景：前导点 + 白名单后缀（纯 .gitignore 无扩展名，validateFileExtension 已拒）
        const content = new Uint8Array([1])
        const res = await writeRange({
            filename: '.secret.txt', offset: 0, content, totalSize: 1,
        })

        expect(res.success).toBe(true)
        // 前导点被误当扩展簇时 base 为空 → 产生 '-<id>.txt'（连字符开头）
        expect(res.path).toMatch(/\.secret-[0-9a-z]+\.txt$/)
    })

    it('offset>0 后续块：按 offset 追加写，内容拼接正确', async () => {
        const first = await writeRange({
            filename: 'a.zip', offset: 0, content: new Uint8Array([1, 2]), totalSize: 4,
        })
        expect(first.success).toBe(true)
        expect(first.path).toBeTruthy()

        const res = await writeRange({
            path: first.path, offset: 2, content: new Uint8Array([3, 4]),
        })

        expect(res.success).toBe(true)
        expect(res.written).toBe(2)

        const fullPath = resolve(tempDir, first.path!)
        const buf = await readFile(fullPath)
        expect(Array.from(buf)).toEqual([1, 2, 3, 4])
    })

    it('totalSize 预校验：超 50MB 首块即拒绝，不创建文件', async () => {
        const res = await writeRange({
            filename: 'big.zip', offset: 0, content: new Uint8Array([1]),
            totalSize: 50 * 1024 * 1024 + 1,
        })

        expect(res.success).toBe(false)
        expect(res.error).toMatch(/too large/i)
    })

    it('扩展名校验：黑名单/非白名单拒绝', async () => {
        const res = await writeRange({
            filename: 'evil.exe', offset: 0, content: new Uint8Array([1]), totalSize: 1,
        })

        expect(res.success).toBe(false)
    })

    it('path 遍历防护：后续块 path 逃逸 uploads 目录拒绝', async () => {
        const res = await writeRange({
            path: '../../../etc/passwd', offset: 0, content: new Uint8Array([1]),
        })

        expect(res.success).toBe(false)
    })

    it('offset>0 但文件不存在（path 指向不存在的路径）：open r+ 失败 → rpcError', async () => {
        const first = await writeRange({
            filename: 'create.zip', offset: 0, content: new Uint8Array([1, 2]), totalSize: 2,
        })
        expect(first.success).toBe(true)
        const res = await writeRange({
            path: '.mobi/uploads/2099-01/nope-xxx.png', offset: 5, content: new Uint8Array([3]),
        })
        expect(res.success).toBe(false)
    })

    it('offset=0 但传 path（非 filename）：拒绝（首块必须 filename，#4 防御 offset=0+path 覆盖已存在文件）', async () => {
        const res = await writeRange({
            path: '.mobi/uploads/2099-01/nope.png', offset: 0, content: new Uint8Array([1]),
        })
        // #4: else if(path && offset>0) —— offset=0+path 不满足，走 else 拒绝（防止覆盖已存在 uploads 文件开头）
        expect(res.success).toBe(false)
        expect(res.error).toMatch(/filename.*path|required/i)
    })

    it('offset 越界：后续块 offset > 文件 size → 拒绝，不扩展稀疏文件', async () => {
        const first = await writeRange({
            filename: 'no-hole.zip', offset: 0, content: new Uint8Array([1, 2, 3, 4]), totalSize: 4,
        })
        expect(first.success).toBe(true)
        const res = await writeRange({
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
        const first = await writeRange({
            filename: 'sneaky.zip', offset: 0,
            content: new Uint8Array(new Array(10).fill(0)),
            totalSize: 10,
        })
        expect(first.success).toBe(true)

        // 后续：写一块使累计超 50MB
        const big = new Uint8Array(MAX_UPLOAD_BYTES + 1)
        const res = await writeRange({
            path: first.path, offset: 10, content: big,
        })

        expect(res.success).toBe(false)
        expect(res.error).toMatch(/too large/i)
    })

    it('累计封顶看实际文件大小：tracker 缺失（既有文件 / cli 重启后）仍按文件大小封顶', async () => {
        // 先正常上传一个 dummy，拿到当月 uploads 目录前缀
        const dummy = await writeRange({
            filename: 'probe.png', offset: 0, content: new Uint8Array([1]), totalSize: 1,
        })
        expect(dummy.success).toBe(true)
        const dir = dummy.path!.replace(/[^/]+$/, '')
        const targetRel = dir + 'existing-target.png'
        const targetFull = resolve(tempDir, targetRel)

        // 直接在磁盘造一个接近上限的稀疏文件（不经 handler → writtenTracker 无 entry）
        const fs = await import('fs/promises')
        await fs.writeFile(targetFull, '')
        await fs.truncate(targetFull, MAX_UPLOAD_BYTES - 10)

        // writeFileRange offset>0 指向既有大文件；tracker 无 entry，须按实际文件大小封顶
        const res = await writeRange({
            path: targetRel, offset: MAX_UPLOAD_BYTES - 10, content: new Uint8Array(100),
        })
        // 修复后：baseWritten = max(0, size≈MAX-10)，+100 > MAX → 拒绝
        // （修复前 prevWritten 回退到 0，0+100 < MAX 会放行 → 文件被扩展超限）
        expect(res.success).toBe(false)
        expect(res.error).toMatch(/too large/i)
    })
})

describe('deleteUpload 实现', () => {
    let tempDir: string

    beforeEach(() => {
        tempDir = join(tmpdir(), `mobi-test-del-${Date.now()}-${Math.random().toString(36).slice(2)}`)
        mkdirSync(tempDir, { recursive: true })
    })

    afterEach(() => {
        if (existsSync(tempDir)) {
            rmSync(tempDir, { recursive: true, force: true })
        }
    })

    // 深化候选②票②：socket 注册退场，deleteUploadImpl 直调
    const deleteUpload = (data: { path: string }) => deleteUploadImpl(data, tempDir)
    const writeRange = (data: WriteFileRangeRequest) => writeFileRangeImpl(data, tempDir)

    it('应能删除已上传的文件', async () => {
        const uploadResult = await writeRange({
            filename: 'to-delete.png',
            offset: 0,
            content: new Uint8Array([1, 2, 3]),
            totalSize: 3,
        })

        expect(uploadResult.success).toBe(true)
        const fullPath = resolve(tempDir, uploadResult.path!)
        expect(existsSync(fullPath)).toBe(true)

        const deleteResult = await deleteUpload({ path: uploadResult.path! })
        expect(deleteResult.success).toBe(true)
        expect(existsSync(fullPath)).toBe(false)
    })

    it('应拒绝不在 uploads 目录内的路径', async () => {
        const result = await deleteUpload({ path: '../../../etc/passwd' })
        expect(result.success).toBe(false)
        expect(result.error).toContain('Invalid')
    })

    it('应拒绝空路径', async () => {
        const result = await deleteUpload({ path: '' })
        expect(result.success).toBe(false)
    })
})

describe('replaceUpload 实现', () => {
    let tempDir: string

    beforeEach(() => {
        tempDir = join(tmpdir(), `mobi-test-rep-${Date.now()}-${Math.random().toString(36).slice(2)}`)
        mkdirSync(tempDir, { recursive: true })
    })

    afterEach(() => {
        if (existsSync(tempDir)) {
            rmSync(tempDir, { recursive: true, force: true })
        }
    })

    // 深化候选②票②：socket 注册退场，replaceUploadImpl 直调
    const replaceUpload = (data: { path: string; content: Uint8Array }) => replaceUploadImpl(data, tempDir)
    const writeRange = (data: WriteFileRangeRequest) => writeFileRangeImpl(data, tempDir)

    it('覆盖已存在文件：path 不变、内容换血、无临时文件残留', async () => {
        const uploadResult = await writeRange({
            filename: 'sketch-1.excalidraw.png',
            offset: 0,
            content: new Uint8Array([1, 2, 3]),
            totalSize: 3,
        })
        const relPath = uploadResult.path!

        const replaceResult = await replaceUpload({
            path: relPath,
            content: new Uint8Array([9, 8, 7, 6]),
        })
        expect(replaceResult.success).toBe(true)

        const fullPath = resolve(tempDir, relPath)
        expect(new Uint8Array(await readFile(fullPath))).toEqual(new Uint8Array([9, 8, 7, 6]))
        // 同目录不留 .tmp 残留
        const files = await (await import('fs/promises')).readdir(resolve(fullPath, '..'))
        expect(files.every((f) => !f.endsWith('.tmp'))).toBe(true)
    })

    it('源文件已不存在：幂等写入（目标目录缺位也自动创建）', async () => {
        const result = await replaceUpload({
            path: '.mobi/uploads/2026-01/sketch-old-abc.excalidraw.png',
            content: new Uint8Array([4, 5]),
        })
        expect(result.success).toBe(true)
        expect(new Uint8Array(await readFile(resolve(tempDir, '.mobi/uploads/2026-01/sketch-old-abc.excalidraw.png'))))
            .toEqual(new Uint8Array([4, 5]))
    })

    it('应拒绝不在 uploads 目录内的路径', async () => {
        const result = await replaceUpload({
            path: '../../../etc/passwd',
            content: new Uint8Array([1]),
        })
        expect(result.success).toBe(false)
        expect(result.error).toContain('Invalid')
    })

    it('应拒绝黑名单扩展名的 path', async () => {
        const result = await replaceUpload({
            path: '.mobi/uploads/evil.exe',
            content: new Uint8Array([1]),
        })
        expect(result.success).toBe(false)
    })

    it('应拒绝空内容与空路径', async () => {
        expect((await replaceUpload({ path: '.mobi/uploads/a.png', content: new Uint8Array() })).success).toBe(false)
        expect((await replaceUpload({ path: '', content: new Uint8Array([1]) })).success).toBe(false)
    })
})
