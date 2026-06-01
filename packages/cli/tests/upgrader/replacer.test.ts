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
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir, homedir } from 'node:os'
import { replaceBinary, isInstalledViaInstallScript } from '@/upgrader/replacer'

const tmpDir = join(tmpdir(), `mobi-test-replacer-${process.pid}`)

beforeEach(() => {
    mkdirSync(tmpDir, { recursive: true })
})

afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
})

describe('isInstalledViaInstallScript', () => {
    it('returns true when binary is in ~/.local/bin', () => {
        const home = homedir().replace(/\\/g, '/')
        expect(isInstalledViaInstallScript(`${home}/.local/bin/mobi`)).toBe(true)
    })

    it('returns true when binary is in Windows .local\\bin', () => {
        const home = homedir()
        // 模拟 Windows 路径格式
        expect(isInstalledViaInstallScript(`${home}\\.local\\bin\\mobi.exe`)).toBe(true)
    })

    it('returns false for other paths', () => {
        expect(isInstalledViaInstallScript('/usr/local/bin/mobi')).toBe(false)
    })

    it('returns false for npm global path', () => {
        expect(isInstalledViaInstallScript('/usr/local/lib/node_modules/@mobi/cli/bin/mobi')).toBe(false)
    })
})

describe('replaceBinary', () => {
    it('replaces binary atomically on POSIX', () => {
        const targetPath = join(tmpDir, 'mobi')
        const newBinaryPath = join(tmpDir, 'mobi-new')

        writeFileSync(targetPath, 'old-binary')
        writeFileSync(newBinaryPath, 'new-binary')

        replaceBinary(newBinaryPath, targetPath)

        expect(readFileSync(targetPath, 'utf-8')).toBe('new-binary')
        expect(existsSync(newBinaryPath)).toBe(false)
    })
})
