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

/**
 * daemon 启动的 cwd 兜底：启动目录事后被删（部署收尾删 worktree 的实锤场景）时
 * 切回 home，否则 simple-git 等按 cwd 工作的库整体失效。
 */

import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureUsableCwd } from '../../src/utils/ensureUsableCwd'

const originalCwd = process.cwd()

afterEach(() => {
    process.chdir(originalCwd)
})

describe('ensureUsableCwd', () => {
    it('cwd 有效：保持不动（相对路径语义不受影响）', () => {
        const dir = mkdtempSync(join(tmpdir(), 'mobi-cwd-'))
        try {
            process.chdir(dir)
            const expected = process.cwd()
            ensureUsableCwd()
            expect(process.cwd()).toBe(expected)
        } finally {
            process.chdir(originalCwd)
            rmSync(dir, { recursive: true, force: true })
        }
    })

    it('cwd 已被删除：切到 home', () => {
        const dir = mkdtempSync(join(tmpdir(), 'mobi-cwd-'))
        process.chdir(dir)
        rmSync(dir, { recursive: true, force: true })
        expect(() => ensureUsableCwd()).not.toThrow()
        expect(process.cwd()).toBe(homedir())
    })
})
