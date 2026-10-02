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

    it('hub 文件解析失败时 updateHubSettings 抛错且不覆盖文件（fail-fast 防丢 hub 字段）', async () => {
        writeFileSync(hubFile(), '{broken json')
        const { updateHubSettings } = await loadPersistence()

        await expect(updateHubSettings(s => ({ ...s, listenPort: 3333 }))).rejects.toThrow()

        // 原文件原样保留（不被「只剩 listen*」的内容覆盖）
        expect(readFileSync(hubFile(), 'utf8')).toBe('{broken json')
    })

    describe('migrateLegacyCliSettings（cli 侧一次性迁移，远程部署形态）', () => {
        const legacyFile = () => join(home, 'settings.json')

        it('旧 settings.json 存在时把 cli 字段补缺写入 cli 文件，旧文件保留（归档权归 hub 迁移）', async () => {
            writeFileSync(legacyFile(), JSON.stringify({
                cliApiToken: 'legacy-token',
                machineId: 'legacy-mid',
                claudeEnv: { FOO: '1' },
                webApiToken: 'hub-field',
                listenPort: 2222,
            }))
            const { migrateLegacyCliSettings } = await loadPersistence()

            await migrateLegacyCliSettings()

            const cli = readJson(cliFile())
            expect(cli.cliApiToken).toBe('legacy-token')
            expect(cli.machineId).toBe('legacy-mid')
            expect(cli.claudeEnv).toEqual({ FOO: '1' })
            // hub 专属字段不进 cli 文件
            expect(cli.webApiToken).toBeUndefined()
            expect(cli.listenPort).toBeUndefined()
            // 旧文件保留给 hub 侧迁移
            expect(existsSync(legacyFile())).toBe(true)
        })

        it('cli 文件已有值不覆盖（补缺语义，幂等）', async () => {
            writeFileSync(legacyFile(), JSON.stringify({ cliApiToken: 'legacy-token', machineId: 'legacy-mid' }))
            writeFileSync(cliFile(), JSON.stringify({ cliApiToken: 'current-token' }))
            const { migrateLegacyCliSettings } = await loadPersistence()

            await migrateLegacyCliSettings()

            const cli = readJson(cliFile())
            expect(cli.cliApiToken).toBe('current-token')
            expect(cli.machineId).toBe('legacy-mid')
        })

        it('无旧文件时幂等跳过；旧文件解析失败时跳过不阻断（cli 有交互式 prompt 兜底）', async () => {
            const { migrateLegacyCliSettings } = await loadPersistence()
            await expect(migrateLegacyCliSettings()).resolves.toBeUndefined()
            expect(existsSync(cliFile())).toBe(false)

            writeFileSync(legacyFile(), '{broken json')
            await expect(migrateLegacyCliSettings()).resolves.toBeUndefined()
            expect(existsSync(cliFile())).toBe(false)
        })

        it('cli 文件被清空后重复迁移仍能补齐（hasMissing 判定不误跳）', async () => {
            writeFileSync(legacyFile(), JSON.stringify({ cliApiToken: 'legacy-token' }))
            const { migrateLegacyCliSettings } = await loadPersistence()

            await migrateLegacyCliSettings()
            expect(readJson(cliFile()).cliApiToken).toBe('legacy-token')

            writeFileSync(cliFile(), JSON.stringify({}))
            await migrateLegacyCliSettings()
            expect(readJson(cliFile()).cliApiToken).toBe('legacy-token')
        })
    })

    it('非原子 writeSettings 已删除（所有写必须走锁内入口）', async () => {
        const persistence = await loadPersistence()
        expect((persistence as Record<string, unknown>).writeSettings).toBeUndefined()
    })
})
