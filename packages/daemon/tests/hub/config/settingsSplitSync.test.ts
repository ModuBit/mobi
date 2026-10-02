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
import { mkdtempSync, rmSync, existsSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resetConfiguration, createConfiguration } from '../../src/configuration'
import { updateSettingsFile } from '../../src/config/settings'

/**
 * settings 拆分的两处回归锁定：
 * 1. co-located 开箱即连：全新目录（无 settings.cli.json）下 hub 首启必须创建 cli 文件
 *    并同步 cliApiToken——existsSync 守卫曾使该链路在全新安装上永不触发
 * 2. updateSettingsFile 值未变不写盘：纯读路径不得刷新 mtime / 触发 watcher 事件
 */

let dataDir: string

beforeEach(() => {
    dataDir = join(mkdtempSync(join(tmpdir(), 'mobi-settings-split-')), 'home')
    process.env.MOBI_HOME = dataDir
    process.env.CLI_API_TOKEN = 'env-cli-token'
    delete process.env.WEB_API_TOKEN
    resetConfiguration()
})

afterEach(() => {
    delete process.env.MOBI_HOME
    delete process.env.CLI_API_TOKEN
    resetConfiguration()
    rmSync(dataDir, { recursive: true, force: true })
})

describe('co-located cliApiToken 同步（开箱即连）', () => {
    test('全新目录（cli 文件不存在）：createConfiguration 创建 settings.cli.json 并写入凭证', async () => {
        await createConfiguration()

        const cliFile = join(dataDir, 'settings.cli.json')
        expect(existsSync(cliFile)).toBe(true)
        const cli = JSON.parse(readFileSync(cliFile, 'utf8')) as { cliApiToken?: string }
        expect(cli.cliApiToken).toBe('env-cli-token')
    })

    test('cli 文件已有凭证时不覆盖（auth login 配置的连接凭证归 cli 所有）', async () => {
        const cliFile = join(dataDir, 'settings.cli.json')
        await updateSettingsFile<Record<string, unknown>>(cliFile, (current) => ({
            ...current,
            cliApiToken: 'user-configured-token',
        }))

        await createConfiguration()

        const cli = JSON.parse(readFileSync(cliFile, 'utf8')) as { cliApiToken?: string }
        expect(cli.cliApiToken).toBe('user-configured-token')
    })
})

describe('updateSettingsFile 纯读不写盘', () => {
    test('updater 未改变内容时跳过写盘（mtime 不变）', async () => {
        const file = join(dataDir, 'settings.hub.json')
        await updateSettingsFile(file, (current) => ({ ...current, webApiToken: 't1' }))
        const mtimeBefore = statSync(file).mtimeMs

        // 留出时钟前进空间，确保「真写盘」必然改变 mtime
        await new Promise(r => setTimeout(r, 20))
        await updateSettingsFile(file, (current) => current)
        expect(statSync(file).mtimeMs).toBe(mtimeBefore)
    })

    test('内容有变化时正常写盘', async () => {
        const file = join(dataDir, 'settings.hub.json')
        await updateSettingsFile(file, (current) => ({ ...current, webApiToken: 't1' }))
        const mtimeBefore = statSync(file).mtimeMs

        await new Promise(r => setTimeout(r, 20))
        await updateSettingsFile(file, (current) => ({ ...current, webApiToken: 't2' }))
        expect(statSync(file).mtimeMs).not.toBe(mtimeBefore)
        const settings = JSON.parse(readFileSync(file, 'utf8')) as { webApiToken?: string }
        expect(settings.webApiToken).toBe('t2')
    })
})
