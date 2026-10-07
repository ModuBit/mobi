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
 * listen* 等 daemon 字段经 updateDaemonSettings 写 settings.daemon.json，两文件互不覆盖。
 * 含 501 文件名迁移：旧 settings.hub.json 读旧写新到 settings.daemon.json。
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
const daemonFile = () => join(home, 'settings.daemon.json')

function readJson(file: string): Record<string, unknown> {
    return JSON.parse(readFileSync(file, 'utf8'))
}

describe('cli settings 拆分', () => {
    it('updateSettings 只写 settings.cli.json，不触碰 settings.daemon.json', async () => {
        const { updateSettings } = await loadPersistence()

        await updateSettings(s => ({ ...s, cliApiToken: 'cli-token' }))

        expect(existsSync(cliFile())).toBe(true)
        expect(readJson(cliFile()).cliApiToken).toBe('cli-token')
        expect(existsSync(daemonFile())).toBe(false)
    })

    it('updateDaemonSettings 只写 settings.daemon.json 的 listen*，保留其他字段，不动 cli 文件', async () => {
        writeFileSync(daemonFile(), JSON.stringify({ webApiToken: 'daemon-kept', listenPort: 2222 }))
        writeFileSync(cliFile(), JSON.stringify({ cliApiToken: 'cli-kept' }))
        const { updateDaemonSettings } = await loadPersistence()

        await updateDaemonSettings(s => ({ ...s, listenHost: '0.0.0.0', listenPort: 3000 }))

        const daemon = readJson(daemonFile())
        expect(daemon.listenHost).toBe('0.0.0.0')
        expect(daemon.listenPort).toBe(3000)
        // daemon 文件其他字段保留（受限写，不整文件覆盖）
        expect(daemon.webApiToken).toBe('daemon-kept')
        // cli 文件不动
        expect(readJson(cliFile()).cliApiToken).toBe('cli-kept')
    })

    it('updateDaemonSettings 在文件不存在时创建（co-located 首配场景）', async () => {
        const { updateDaemonSettings } = await loadPersistence()

        await updateDaemonSettings(s => ({ ...s, listenPort: 3333 }))

        expect(readJson(daemonFile())).toEqual({ listenPort: 3333 })
    })

    it('文件解析失败时 updateDaemonSettings 抛错且不覆盖文件（fail-fast 防丢字段）', async () => {
        writeFileSync(daemonFile(), '{broken json')
        const { updateDaemonSettings } = await loadPersistence()

        await expect(updateDaemonSettings(s => ({ ...s, listenPort: 3333 }))).rejects.toThrow()

        // 原文件原样保留（不被「只剩 listen*」的内容覆盖）
        expect(readFileSync(daemonFile(), 'utf8')).toBe('{broken json')
    })

    it('501 读旧写新：仅存量 settings.hub.json 时 updateDaemonSettings rename 到新名再写', async () => {
        writeFileSync(hubFile(), JSON.stringify({ webApiToken: 'legacy-kept', listenPort: 2222 }))
        const { updateDaemonSettings } = await loadPersistence()

        await updateDaemonSettings(s => ({ ...s, listenPort: 4000 }))

        // 旧名消失、内容迁入新名，listen* 更新、其余字段保留
        expect(existsSync(hubFile())).toBe(false)
        const daemon = readJson(daemonFile())
        expect(daemon.webApiToken).toBe('legacy-kept')
        expect(daemon.listenPort).toBe(4000)
    })

    it('501 读旧写新：新名缺失且旧名存在时 readDaemonSettings 读旧文件（升级窗口兼容）', async () => {
        writeFileSync(hubFile(), JSON.stringify({ listenPort: 2222 }))
        const { readDaemonSettings } = await loadPersistence()

        await expect(readDaemonSettings()).resolves.toEqual({ listenPort: 2222 })
        // 纯读不迁移（迁移只在写路径发生）
        expect(existsSync(hubFile())).toBe(true)
        expect(existsSync(daemonFile())).toBe(false)
    })

    describe('migrateLegacyCliSettings（cli 侧一次性迁移，远程部署形态）', () => {
        const legacyFile = () => join(home, 'settings.json')

        it('旧 settings.json 存在时把 cli 字段补缺写入 cli 文件，旧文件保留（归档权归 daemon 迁移）', async () => {
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
            // machineId 已随 machine 概念移除（503）：不再迁移进 cli 文件
            expect(cli.machineId).toBeUndefined()
            expect(cli.claudeEnv).toEqual({ FOO: '1' })
            // hub 专属字段不进 cli 文件
            expect(cli.webApiToken).toBeUndefined()
            expect(cli.listenPort).toBeUndefined()
            // 旧文件保留给 hub 侧迁移
            expect(existsSync(legacyFile())).toBe(true)
        })

        it('cli 文件已有值不覆盖（补缺语义，幂等）', async () => {
            writeFileSync(legacyFile(), JSON.stringify({ cliApiToken: 'legacy-token' }))
            writeFileSync(cliFile(), JSON.stringify({ cliApiToken: 'current-token' }))
            const { migrateLegacyCliSettings } = await loadPersistence()

            await migrateLegacyCliSettings()

            const cli = readJson(cliFile())
            expect(cli.cliApiToken).toBe('current-token')
            expect(cli.cliApiToken).not.toBe('legacy-token')
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

    it('503 machineId 清除：cli 配置残留字段被一次性删除，其余字段保留（幂等）', async () => {
        writeFileSync(cliFile(), JSON.stringify({ cliApiToken: 'kept', machineId: 'legacy-mid', updateChannel: 'beta' }))
        const { migrateLegacyCliSettings } = await loadPersistence()

        await migrateLegacyCliSettings()

        const cli = readJson(cliFile())
        expect(cli.machineId).toBeUndefined()
        expect(cli.cliApiToken).toBe('kept')
        expect(cli.updateChannel).toBe('beta')

        // 幂等：再跑不写盘（无残留直接返回）
        await migrateLegacyCliSettings()
        expect(readJson(cliFile()).cliApiToken).toBe('kept')
    })

    it('非原子 writeSettings 已删除（所有写必须走锁内入口）', async () => {
        const persistence = await loadPersistence()
        expect((persistence as Record<string, unknown>).writeSettings).toBeUndefined()
    })
})
