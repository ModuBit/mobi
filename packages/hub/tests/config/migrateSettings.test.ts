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

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrateLegacySettings } from '../../src/config/migrateSettings'

let dataDir: string

beforeEach(() => {
    dataDir = join(mkdtempSync(join(tmpdir(), 'mobi-migrate-')), 'home')
    mkdirSync(dataDir, { recursive: true })
})

afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true })
})

const LEGACY_FULL = {
    // hub 字段
    cliApiToken: 'cli-token-123',
    webApiToken: 'web-token-456',
    vapidKeys: { publicKey: 'pk', privateKey: 'sk' },
    listenHost: '127.0.0.1',
    listenPort: 2222,
    publicUrl: 'https://mobi.example.com',
    corsOrigins: ['https://mobi.example.com'],
    hubName: 'home-mac',
    // cli 字段
    machineId: 'mid-1',
    apiUrl: 'http://localhost:2222',
    updateChannel: 'stable',
    disconnectTimeoutMs: 600000,
    claudeEnv: { FOO: '1' },
    bashInjectContext: false,
    webTools: { searchProviderId: 'tavily' },
    // 死字段（不迁移）
    machineIdConfirmedByServer: true,
    runnerAutoStartWhenRunningMobi: true,
}

function readJson(file: string): Record<string, unknown> {
    return JSON.parse(readFileSync(file, 'utf8'))
}

describe('migrateLegacySettings', () => {
    test('完整旧文件按归属拆写两新文件，旧文件改名 .bak，死字段丢弃', async () => {
        const legacy = join(dataDir, 'settings.json')
        writeFileSync(legacy, JSON.stringify(LEGACY_FULL))

        const result = await migrateLegacySettings(dataDir)

        expect(result).toEqual({ migrated: true, reason: 'migrated' })
        // 旧文件已改名
        expect(existsSync(legacy)).toBe(false)
        expect(existsSync(legacy + '.bak')).toBe(true)

        const hub = readJson(join(dataDir, 'settings.hub.json'))
        expect(hub.cliApiToken).toBe('cli-token-123')
        expect(hub.webApiToken).toBe('web-token-456')
        expect(hub.vapidKeys).toEqual({ publicKey: 'pk', privateKey: 'sk' })
        expect(hub.listenPort).toBe(2222)
        expect(hub.hubName).toBe('home-mac')
        // hub 文件不落 cli 字段
        expect(hub.machineId).toBeUndefined()
        expect(hub.claudeEnv).toBeUndefined()

        const cli = readJson(join(dataDir, 'settings.cli.json'))
        expect(cli.machineId).toBe('mid-1')
        expect(cli.apiUrl).toBe('http://localhost:2222')
        expect(cli.updateChannel).toBe('stable')
        expect(cli.disconnectTimeoutMs).toBe(600000)
        expect(cli.claudeEnv).toEqual({ FOO: '1' })
        expect(cli.bashInjectContext).toBe(false)
        expect(cli.webTools).toEqual({ searchProviderId: 'tavily' })
        // cli 文件不落 hub 字段
        expect(cli.webApiToken).toBeUndefined()
        expect(cli.listenPort).toBeUndefined()
        // 死字段两文件都不落
        expect(cli.machineIdConfirmedByServer).toBeUndefined()
        expect(hub.runnerAutoStartWhenRunningMobi).toBeUndefined()
    })

    test('无旧文件 → 幂等跳过', async () => {
        const result = await migrateLegacySettings(dataDir)
        expect(result).toEqual({ migrated: false, reason: 'no-legacy' })
        expect(existsSync(join(dataDir, 'settings.hub.json'))).toBe(false)
    })

    test('已迁移（hub 文件已存在）→ 旧字段仅补缺、不覆盖新值，旧文件归档 .bak', async () => {
        // 场景：hub 新文件已存在（如升级后先跑过 wizard / 旧 .bak 被手动还原）。
        // 旧文件不能整文件覆盖新文件，也不能静默丢弃——按补缺合并后归档。
        writeFileSync(join(dataDir, 'settings.json'), JSON.stringify(LEGACY_FULL))
        writeFileSync(join(dataDir, 'settings.hub.json'), JSON.stringify({ cliApiToken: 'hub-kept' }))
        writeFileSync(join(dataDir, 'settings.cli.json'), JSON.stringify({ cliApiToken: 'cli-kept' }))

        const result = await migrateLegacySettings(dataDir)

        expect(result).toEqual({ migrated: true, reason: 'migrated' })
        // 旧文件归档
        expect(existsSync(join(dataDir, 'settings.json'))).toBe(false)
        expect(existsSync(join(dataDir, 'settings.json.bak'))).toBe(true)

        const hub = readJson(join(dataDir, 'settings.hub.json'))
        // 已有值不被旧文件覆盖
        expect(hub.cliApiToken).toBe('hub-kept')
        // 缺失字段由旧文件补齐
        expect(hub.webApiToken).toBe('web-token-456')
        expect(hub.listenPort).toBe(2222)

        const cli = readJson(join(dataDir, 'settings.cli.json'))
        expect(cli.cliApiToken).toBe('cli-kept')
        expect(cli.machineId).toBe('mid-1')
        expect(cli.claudeEnv).toEqual({ FOO: '1' })
    })

    test('cli 文件已存在时拆分合并，不覆盖已有 cliApiToken', async () => {
        // 场景：升级后先跑 mobi setup 生成 cli 凭证，再启动 hub 触发迁移
        writeFileSync(join(dataDir, 'settings.json'), JSON.stringify(LEGACY_FULL))
        writeFileSync(join(dataDir, 'settings.cli.json'), JSON.stringify({ cliApiToken: 'wizard-generated' }))

        const result = await migrateLegacySettings(dataDir)

        expect(result).toEqual({ migrated: true, reason: 'migrated' })
        const cli = readJson(join(dataDir, 'settings.cli.json'))
        expect(cli.cliApiToken).toBe('wizard-generated')
        expect(cli.machineId).toBe('mid-1')
    })

    test('旧文件解析失败 → fail-fast 不动任何文件', async () => {
        writeFileSync(join(dataDir, 'settings.json'), '{broken json')

        const result = await migrateLegacySettings(dataDir)

        expect(result).toEqual({ migrated: false, reason: 'parse-error' })
        expect(existsSync(join(dataDir, 'settings.json'))).toBe(true)
        expect(existsSync(join(dataDir, 'settings.hub.json'))).toBe(false)
    })
})
