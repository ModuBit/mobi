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
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getOrCreateWebApiToken } from '../../src/config/webApiToken'

describe('getOrCreateWebApiToken', () => {
    let dataDir: string
    let prevEnvToken: string | undefined

    beforeEach(async () => {
        dataDir = await mkdtemp(join(tmpdir(), 'mobi-webtoken-'))
        // 隔离环境变量：保证每个测试从干净起点开始，避免 CI/dev shell 导出 WEB_API_TOKEN 导致 flaky
        prevEnvToken = process.env.WEB_API_TOKEN
        delete process.env.WEB_API_TOKEN
    })

    afterEach(async () => {
        await rm(dataDir, { recursive: true, force: true })
        // 恢复环境变量（undefined 则 delete）
        if (prevEnvToken === undefined) delete process.env.WEB_API_TOKEN
        else process.env.WEB_API_TOKEN = prevEnvToken
    })

    test('首次调用自动生成并持久化 webApiToken', async () => {
        const result = await getOrCreateWebApiToken(dataDir)
        // randomBytes(32).toString('base64url') 恒为 43 字符
        expect(result.token).toHaveLength(43)
        expect(result.isNew).toBe(true)
        expect(result.source).toBe('generated')

        // 第二次调用应读回同一个值
        const again = await getOrCreateWebApiToken(dataDir)
        expect(again.token).toBe(result.token)
        expect(again.isNew).toBe(false)
        expect(again.source).toBe('file')
    })

    test('环境变量 WEB_API_TOKEN 优先级高于 settings.hub.json 文件值', async () => {
        // 预置文件中的竞争 token，证明 env 真正胜过 file
        await writeFile(
            join(dataDir, 'settings.hub.json'),
            JSON.stringify({ webApiToken: 'file-token-value' })
        )
        process.env.WEB_API_TOKEN = 'env-web-token-value'

        const result = await getOrCreateWebApiToken(dataDir)
        expect(result.token).toBe('env-web-token-value')
        expect(result.source).toBe('env')
    })

    test('环境变量 WEB_API_TOKEN 持久化到已有 settings.hub.json', async () => {
        // 预置一个不含 webApiToken 的 settings.hub.json，覆盖持久化子分支
        await writeFile(
            join(dataDir, 'settings.hub.json'),
            JSON.stringify({ cliApiToken: 'x' })
        )
        process.env.WEB_API_TOKEN = 'env-web-token-value'

        const result = await getOrCreateWebApiToken(dataDir)
        expect(result.token).toBe('env-web-token-value')

        const content = await readFile(join(dataDir, 'settings.hub.json'), 'utf8')
        const parsed = JSON.parse(content)
        // env 值被写入磁盘
        expect(parsed.webApiToken).toBe('env-web-token-value')
        // 原有字段保留
        expect(parsed.cliApiToken).toBe('x')
    })

    test('不破坏 settings.hub.json 中的其他字段', async () => {
        await writeFile(join(dataDir, 'settings.hub.json'), JSON.stringify({ cliApiToken: 'preexisting' }))
        await getOrCreateWebApiToken(dataDir)

        const content = await readFile(join(dataDir, 'settings.hub.json'), 'utf8')
        const parsed = JSON.parse(content)
        expect(parsed.cliApiToken).toBe('preexisting')
        expect(typeof parsed.webApiToken).toBe('string')
    })
})
