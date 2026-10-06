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

// loadServerSettings 的 daemonName 读旧写新（remove-machine 501）：
// 文件键 hubName 与 env MOBI_HUB_NAME 为旧名，读取兼容；回填恒写新键 daemonName。

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadServerSettings } from '../../../src/config/serverSettings'

describe('loadServerSettings daemonName 读旧写新（501）', () => {
    let dataDir: string
    const savedEnv: Record<string, string | undefined> = {}

    beforeEach(async () => {
        dataDir = await mkdtemp(join(tmpdir(), 'mobi-server-settings-'))
        for (const key of ['MOBI_DAEMON_NAME', 'MOBI_HUB_NAME', 'MOBI_LISTEN_HOST', 'MOBI_LISTEN_PORT', 'MOBI_PUBLIC_URL', 'CORS_ORIGINS']) {
            savedEnv[key] = process.env[key]
            delete process.env[key]
        }
    })

    afterEach(async () => {
        await rm(dataDir, { recursive: true, force: true })
        for (const [key, value] of Object.entries(savedEnv)) {
            if (value === undefined) delete process.env[key]
            else process.env[key] = value
        }
    })

    test('文件旧键 hubName 兼容读取（sources=file）', async () => {
        await writeFile(join(dataDir, 'settings.daemon.json'), JSON.stringify({ hubName: 'legacy-name' }))

        const result = await loadServerSettings(dataDir)

        expect(result.settings.daemonName).toBe('legacy-name')
        expect(result.sources.daemonName).toBe('file')
    })

    test('文件新键 daemonName 优先于旧键 hubName', async () => {
        await writeFile(
            join(dataDir, 'settings.daemon.json'),
            JSON.stringify({ hubName: 'legacy-name', daemonName: 'new-name' })
        )

        const result = await loadServerSettings(dataDir)

        expect(result.settings.daemonName).toBe('new-name')
    })

    test('MOBI_HUB_NAME 旧 env 兼容读取且回填写新键 daemonName', async () => {
        process.env.MOBI_HUB_NAME = 'env-legacy-name'

        const result = await loadServerSettings(dataDir)

        expect(result.settings.daemonName).toBe('env-legacy-name')
        expect(result.sources.daemonName).toBe('env')
        // 回填恒写新键：文件中出现 daemonName，不再出现 hubName
        const file = JSON.parse(await readFile(join(dataDir, 'settings.daemon.json'), 'utf8'))
        expect(file.daemonName).toBe('env-legacy-name')
        expect(file.hubName).toBeUndefined()
    })

    test('MOBI_DAEMON_NAME 优先于旧 env MOBI_HUB_NAME', async () => {
        process.env.MOBI_DAEMON_NAME = 'new-env-name'
        process.env.MOBI_HUB_NAME = 'old-env-name'

        const result = await loadServerSettings(dataDir)

        expect(result.settings.daemonName).toBe('new-env-name')
    })
})
