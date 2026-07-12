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
import { mkdtemp, rm, writeFile, rename } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createConfiguration, resetConfiguration, configuration } from '../../src/configuration'
import { startWebApiTokenWatcher, type SettingsWatcher } from '../../src/config/settingsWatcher'

// 轮询断言：fs.watch 异步触发，等条件满足或超时
// macOS FSEvents 延迟可达数秒，超时给足 3000ms 避免误报
async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
        if (predicate()) return
        await new Promise(r => setTimeout(r, 30))
    }
    throw new Error(`waitFor 超时（${timeoutMs}ms）`)
}

describe('startWebApiTokenWatcher', () => {
    let dataDir: string
    let watcher: SettingsWatcher | undefined

    beforeEach(async () => {
        dataDir = await mkdtemp(join(tmpdir(), 'mobi-watcher-'))
        process.env.MOBI_HOME = dataDir
        resetConfiguration()
        await createConfiguration()
    })

    afterEach(async () => {
        watcher?.stop()
        watcher = undefined
        delete process.env.MOBI_HOME
        resetConfiguration()
        await rm(dataDir, { recursive: true, force: true })
    })

    test('外部重写 settings.json 的 webApiToken 后，configuration 热更新', async () => {
        const before = configuration.webApiToken
        watcher = startWebApiTokenWatcher()

        // 等待 FSEvents/inotify 注册目录监听（macOS FSEvents 需要一小段准备时间）
        await new Promise(r => setTimeout(r, 300))

        // 原子重写（tmp + rename，模拟 CLI updateSettings 与 hub writeSettings）
        const settingsFile = join(dataDir, 'settings.json')
        const newToken = 'rotated-web-token-' + Date.now()
        await writeFile(settingsFile + '.tmp', JSON.stringify({ webApiToken: newToken }))
        await rename(settingsFile + '.tmp', settingsFile)

        await waitFor(() => configuration.webApiToken === newToken)
        expect(configuration.webApiToken).toBe(newToken)
        expect(configuration.webApiToken).not.toBe(before)
    })

    test('只改其他字段时不触发 webApiToken reload', async () => {
        const before = configuration.webApiToken
        watcher = startWebApiTokenWatcher()

        // 等待 FSEvents/inotify 注册目录监听
        await new Promise(r => setTimeout(r, 300))

        const settingsFile = join(dataDir, 'settings.json')
        await writeFile(settingsFile + '.tmp', JSON.stringify({ webApiToken: before, hubName: 'changed' }))
        await rename(settingsFile + '.tmp', settingsFile)

        // 等足够 debounce 窗口后断言未变
        await new Promise(r => setTimeout(r, 400))
        expect(configuration.webApiToken).toBe(before)
    })
})
