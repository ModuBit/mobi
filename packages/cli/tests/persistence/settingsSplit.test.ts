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

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * settings 拆分（cli 侧）：updateSettings 只动 settings.cli.json，
 * listen* 等 hub 字段经 updateHubSettings 写 settings.hub.json，两文件互不覆盖。
 */

let home: string

beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), 'mobi-cli-persistence-'))
    process.env.MOBI_HOME = home
    vi.resetModules()
})

afterEach(() => {
    delete process.env.MOBI_HOME
    rmSync(home, { recursive: true, force: true })
})

async function loadPersistence() {
    return await import('@/persistence')
}

const cliFile = () => join(home, 'settings.cli.json')
const hubFile = () => join(home, 'settings.hub.json')

function readJson(file: string): Record<string, unknown> {
    return JSON.parse(readFileSync(file, 'utf8'))
}

describe('cli settings 拆分', () => {
    it('updateSettings 只写 settings.cli.json，不触碰 settings.hub.json', async () => {
        const { updateSettings } = await loadPersistence()

        await updateSettings(s => ({ ...s, cliApiToken: 'cli-token', machineId: 'mid' }))

        expect(existsSync(cliFile())).toBe(true)
        expect(readJson(cliFile()).cliApiToken).toBe('cli-token')
        expect(existsSync(hubFile())).toBe(false)
    })

    it('updateHubSettings 只写 settings.hub.json 的 listen*，保留 hub 文件其他字段，不动 cli 文件', async () => {
        writeFileSync(hubFile(), JSON.stringify({ webApiToken: 'hub-kept', listenPort: 2222 }))
        writeFileSync(cliFile(), JSON.stringify({ cliApiToken: 'cli-kept' }))
        const { updateHubSettings } = await loadPersistence()

        await updateHubSettings(s => ({ ...s, listenHost: '0.0.0.0', listenPort: 3000 }))

        const hub = readJson(hubFile())
        expect(hub.listenHost).toBe('0.0.0.0')
        expect(hub.listenPort).toBe(3000)
        // hub 文件其他字段保留（受限写，不整文件覆盖）
        expect(hub.webApiToken).toBe('hub-kept')
        // cli 文件不动
        expect(readJson(cliFile()).cliApiToken).toBe('cli-kept')
    })

    it('updateHubSettings 在 hub 文件不存在时创建（co-located 首配场景）', async () => {
        const { updateHubSettings } = await loadPersistence()

        await updateHubSettings(s => ({ ...s, listenPort: 3333 }))

        expect(readJson(hubFile())).toEqual({ listenPort: 3333 })
    })

    it('非原子 writeSettings 已删除（所有写必须走锁内入口）', async () => {
        const persistence = await loadPersistence()
        expect((persistence as Record<string, unknown>).writeSettings).toBeUndefined()
    })
})
