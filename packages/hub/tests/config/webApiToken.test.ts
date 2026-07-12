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
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getOrCreateWebApiToken } from '../../src/config/webApiToken'

describe('getOrCreateWebApiToken', () => {
    let dataDir: string

    beforeEach(async () => {
        dataDir = await mkdtemp(join(tmpdir(), 'mobi-webtoken-'))
    })

    afterEach(async () => {
        await rm(dataDir, { recursive: true, force: true })
    })

    test('首次调用自动生成并持久化 webApiToken', async () => {
        const result = await getOrCreateWebApiToken(dataDir)
        expect(result.token.length).toBeGreaterThanOrEqual(32)
        expect(result.isNew).toBe(true)
        expect(result.source).toBe('generated')

        // 第二次调用应读回同一个值
        const again = await getOrCreateWebApiToken(dataDir)
        expect(again.token).toBe(result.token)
        expect(again.isNew).toBe(false)
        expect(again.source).toBe('file')
    })

    test('环境变量 WEB_API_TOKEN 优先级最高', async () => {
        const prev = process.env.WEB_API_TOKEN
        process.env.WEB_API_TOKEN = 'env-web-token-value'
        try {
            const result = await getOrCreateWebApiToken(dataDir)
            expect(result.token).toBe('env-web-token-value')
            expect(result.source).toBe('env')
        } finally {
            if (prev === undefined) delete process.env.WEB_API_TOKEN
            else process.env.WEB_API_TOKEN = prev
        }
    })

    test('不破坏 settings.json 中的其他字段', async () => {
        await writeFile(join(dataDir, 'settings.json'), JSON.stringify({ cliApiToken: 'preexisting' }))
        await getOrCreateWebApiToken(dataDir)

        const content = await import('node:fs/promises').then(fs => fs.readFile(join(dataDir, 'settings.json'), 'utf8'))
        const parsed = JSON.parse(content)
        expect(parsed.cliApiToken).toBe('preexisting')
        expect(typeof parsed.webApiToken).toBe('string')
    })
})
