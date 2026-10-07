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
import { homedir, tmpdir } from 'os'
import { join } from 'path'
import { saveFileImpl } from '@/handlers/files'
import { hostReadFileMetaImpl, hostReadFileRangeImpl } from '@/handlers/hostFiles'

/**
 * 文件读写实现测试（readFileMeta / readFileRange / saveFile）
 *
 * 深化候选②票②：socket 注册退场（registerFileHandlers 及其 readFileMeta / readFileRange /
 * writeFile 闭包已删），读取侧移植到 hostReadFileMetaImpl / hostReadFileRangeImpl 直调
 * （data.cwd 注入会话工作区、homeDir 注入临时 home——与原 session 注册闭包同参形态），
 * 写侧移植到 saveFileImpl 直调。
 *
 * 已删用例（hostFiles.test.ts 有等价覆盖，避免双份维护）：
 * - readFileMeta「返回 mime/size/etag」→ hostFiles「cwd 内白名单文件 → meta」
 * - readFileMeta「路径越权 → 失败」→ hostFiles「../ 逃逸」「同前缀兄弟目录」
 * - readFileRange「文件不存在 → ENOENT」→ hostFiles「ENOENT 结构化码透传」
 * - writeFile「写边界：~ 路径拒绝」→ writeFile RPC 已随注册退场无 Impl；写边界
 *   validateWritePath 由本文件 saveFile ~ 拒绝用例（同一校验函数）同源覆盖
 */

describe('file 读写实现', () => {
    let rootDir: string

    beforeEach(async () => {
        // 兜底：上一个 it 若抛异常，afterEach 可能没跑，这里先清残留再建新目录
        if (rootDir) {
            await rm(rootDir, { recursive: true, force: true })
        }
        rootDir = await mkdtemp(join(tmpdir(), 'mobi-files-'))
    })

    afterEach(async () => {
        if (rootDir) {
            await rm(rootDir, { recursive: true, force: true })
        }
    })

    describe('readFileMeta', () => {
        // 深化候选②票②：socket 注册退场，hostReadFileMetaImpl 直调（homeDir 与原注册默认一致）
        const meta = (path: string) => hostReadFileMetaImpl({ path, cwd: rootDir }, homedir())

        it('未知扩展名 → application/octet-stream', async () => {
            await writeFile(join(rootDir, 'weird.xyz'), 'x')
            const r = (await meta('weird.xyz')) as { success: boolean; meta?: { mime: string } }
            expect(r.meta?.mime).toBe('application/octet-stream')
        })
    })

    describe('读边界放宽（ADR 0004：cwd ∪ home−黑名单）', () => {
        let homeDir: string

        beforeEach(async () => {
            homeDir = await mkdtemp(join(tmpdir(), 'mobi-home-'))
        })
        afterEach(async () => {
            await rm(homeDir, { recursive: true, force: true })
        })

        it('~ 路径（home 通道）meta 可读：expand 后 stat 到真实文件', async () => {
            await writeFile(join(homeDir, 'note.md'), 'E2E home note')
            const r = (await hostReadFileMetaImpl({ path: '~/note.md', cwd: rootDir }, homeDir)) as { success: boolean; error?: string }
            expect(r.success).toBe(true)
        })

        it('黑名单目录（home 直接子级 .ssh）拒绝', async () => {
            const r = (await hostReadFileMetaImpl({ path: '~/.ssh/id_rsa', cwd: rootDir }, homeDir)) as { success: boolean; error?: string; code?: string }
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
            const r = (await hostReadFileMetaImpl({ path: '.mobi/uploads/a.pdf', cwd: rootDir }, homeDir)) as { success: boolean }
            expect(r.success).toBe(true)
        })

        it('writable 判定：~ 路径=false（cwd/~/x 不误判），cwd 内=true', async () => {
            // 回归：writableOf 未展开 ~ 时，~/x 被 resolve 成 cwd/~/x 误判 writable=true
            await writeFile(join(homeDir, 'note.md'), 'hello')
            const r = (await hostReadFileMetaImpl({ path: '~/note.md', cwd: rootDir }, homeDir)) as { success: boolean; writable?: boolean }
            expect(r.success).toBe(true)
            expect(r.writable).toBe(false)

            await writeFile(join(rootDir, 'a.txt'), 'hello')
            const r2 = (await hostReadFileMetaImpl({ path: 'a.txt', cwd: rootDir }, homeDir)) as { success: boolean; writable?: boolean }
            expect(r2.writable).toBe(true)
        })

        it('saveFile 写边界：~ 路径拒绝（不落字面 cwd/~ 目录）', async () => {
            await writeFile(join(homeDir, 'note.md'), 'hello')
            // 深化候选②票②：socket 注册退场，saveFileImpl 直调
            const r = await saveFileImpl({ path: '~/note.md', content: new Uint8Array([120]), baseEtag: '' }, rootDir, homeDir)
            expect(r.success).toBe(false)
            expect(r.error).toContain('outside the working directory')
            await expect(stat(join(rootDir, '~', 'note.md'))).rejects.toMatchObject({ code: 'ENOENT' })
        })

        it('readFileRange 走同一读边界（~ 路径读字节）', async () => {
            await writeFile(join(homeDir, 'bin.dat'), 'abcdef')
            const r = (await hostReadFileRangeImpl({ path: '~/bin.dat', cwd: rootDir, offset: 0, length: 3 }, homeDir)) as { success: boolean; chunk?: Uint8Array }
            expect(r.success).toBe(true)
            expect(Array.from(r.chunk ?? [])).toEqual([97, 98, 99])
        })
    })

    describe('readFileRange', () => {
        // 深化候选②票②：socket 注册退场，hostReadFileRangeImpl 直调（homeDir 与原注册默认一致）
        const range = (path: string, offset: number, length: number) =>
            hostReadFileRangeImpl({ path, cwd: rootDir, offset, length }, homedir())

        it('读取指定 [offset, offset+length) 段，字节正确', async () => {
            await writeFile(join(rootDir, 'b.bin'), Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]))

            const r = (await range('b.bin', 3, 4)) as { success: boolean; chunk?: Uint8Array }

            expect(r.success).toBe(true)
            expect(Array.from(r.chunk ?? [])).toEqual([3, 4, 5, 6])
        })

        it('offset=0 读首段；末段自动 clamp 到文件末尾', async () => {
            await writeFile(join(rootDir, 'c.txt'), 'abcdef')

            const r = (await range('c.txt', 0, 100)) as { success: boolean; chunk?: Uint8Array }

            const text = Array.from(r.chunk ?? [])
                .map((b) => String.fromCharCode(b))
                .join('')
            expect(text).toBe('abcdef')
        })

        it('offset 超出文件大小 → 失败', async () => {
            await writeFile(join(rootDir, 'd.txt'), 'ab')

            const r = (await range('d.txt', 10, 5)) as { success: boolean }

            expect(r.success).toBe(false)
        })

        it('offset 为 NaN → 失败（不绕过越界检查）', async () => {
            await writeFile(join(rootDir, 'e.txt'), 'abc')

            const r = (await range('e.txt', NaN, 2)) as { success: boolean }

            expect(r.success).toBe(false)
        })
    })
})
