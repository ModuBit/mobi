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
import { chmod, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { readFileMetaAt, readFileRangeAt } from '@/modules/common/handlers/fileRead'

describe('readFileMetaAt', () => {
    let rootDir: string

    beforeEach(async () => {
        rootDir = await mkdtemp(join(tmpdir(), 'mobi-file-meta-'))
    })

    afterEach(async () => {
        await rm(rootDir, { recursive: true, force: true })
    })

    it('返回 mime/size/etag 元数据（etag = size-mtimeMs）', async () => {
        const path = join(rootDir, 'meta.txt')
        await writeFile(path, 'abc')

        const result = await readFileMetaAt(path)

        expect(result.success).toBe(true)
        if (result.success) {
            expect(result.meta.mime).toBe('text/plain')
            expect(result.meta.size).toBe(3)
            expect(result.meta.etag).toMatch(/^\d+-\d+$/)
        }
    })

    it('文件不存在 → ENOENT 保留为结构化错误码', async () => {
        const result = await readFileMetaAt(join(rootDir, 'missing.txt'))

        expect(result.success).toBe(false)
        if (!result.success) {
            expect(result.code).toBe('ENOENT')
            expect(result.error).toContain('missing.txt')
        }
    })
})

describe('readFileRangeAt', () => {
    let rootDir: string

    beforeEach(async () => {
        rootDir = await mkdtemp(join(tmpdir(), 'mobi-file-read-'))
    })

    afterEach(async () => {
        await rm(rootDir, { recursive: true, force: true })
    })

    it('读取请求范围，并把末段截断到文件末尾', async () => {
        const path = join(rootDir, 'range.bin')
        await writeFile(path, Buffer.from([0, 1, 2, 3, 4, 5]))

        const result = await readFileRangeAt(path, 3, 100)

        expect(result.success).toBe(true)
        if (result.success) {
            expect(Array.from(result.chunk)).toEqual([3, 4, 5])
        }
    })

    it('拒绝非有限数或负数范围', async () => {
        const path = join(rootDir, 'invalid.bin')
        await writeFile(path, 'abc')

        await expect(readFileRangeAt(path, Number.NaN, 2)).resolves.toEqual({
            success: false,
            error: 'Invalid offset or length',
        })
        await expect(readFileRangeAt(path, 0, -1)).resolves.toEqual({
            success: false,
            error: 'Invalid offset or length',
        })
    })

    it('拒绝空范围和超出文件末尾的起点', async () => {
        const path = join(rootDir, 'bounds.bin')
        await writeFile(path, 'abc')

        await expect(readFileRangeAt(path, 3, 1)).resolves.toEqual({
            success: false,
            error: 'Range out of bounds',
        })
        await expect(readFileRangeAt(path, 0, 0)).resolves.toEqual({
            success: false,
            error: 'Range out of bounds',
        })
    })

    it('把文件系统的 ENOENT 保留为结构化错误码', async () => {
        const path = join(rootDir, 'missing.bin')

        const result = await readFileRangeAt(path, 0, 1)

        expect(result.success).toBe(false)
        if (!result.success) {
            expect(result.code).toBe('ENOENT')
            expect(result.error).toContain('missing.bin')
        }
    })

    it('非映射 errno（EACCES）也保留结构化错误码', async () => {
        const path = join(rootDir, 'secret.bin')
        await writeFile(path, 'abc')
        await chmod(path, 0o000)

        try {
            const result = await readFileRangeAt(path, 0, 1)

            expect(result.success).toBe(false)
            if (!result.success) {
                expect(result.code).toBe('EACCES')
            }
        } finally {
            await chmod(path, 0o644)
        }
    })

    it('缺省范围时从文件开头读取一个标准分片', async () => {
        const path = join(rootDir, 'defaults.bin')
        await writeFile(path, 'abc')

        const result = await readFileRangeAt(path, undefined, undefined)

        expect(result.success).toBe(true)
        if (result.success) {
            expect(Buffer.from(result.chunk).toString()).toBe('abc')
        }
    })
})
