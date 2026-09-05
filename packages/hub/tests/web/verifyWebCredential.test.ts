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
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resetConfiguration, createConfiguration } from '../../src/configuration'
import { verifyWebCredential } from '../../src/web/auth/verifyWebCredential'

describe('verifyWebCredential', () => {
    let isolatedHome: string

    beforeEach(async () => {
        // MOBI_HOME 指向临时目录：createConfiguration（含迁移/写盘）不得触碰真实 ~/.mobi
        isolatedHome = mkdtempSync(join(tmpdir(), 'mobi-verify-web-cred-'))
        process.env.MOBI_HOME = isolatedHome
        process.env.WEB_API_TOKEN = 'the-web-token'
        process.env.CLI_API_TOKEN = 'the-cli-token'
        resetConfiguration()
        await createConfiguration()
    })

    afterEach(() => {
        delete process.env.WEB_API_TOKEN
        delete process.env.CLI_API_TOKEN
        delete process.env.MOBI_HOME
        resetConfiguration()
        rmSync(isolatedHome, { recursive: true, force: true })
    })

    test('webApiToken 验证通过', async () => {
        const result = await verifyWebCredential('the-web-token')
        expect(result).not.toBeNull()
        expect(result?.namespace).toBe('default')
    })

    test('cliApiToken 必须被拒绝（隔离核心断言）', async () => {
        const result = await verifyWebCredential('the-cli-token')
        expect(result).toBeNull()
    })

    test('无效 token 被拒绝', async () => {
        const result = await verifyWebCredential('random-wrong-token')
        expect(result).toBeNull()
    })

    test('带命名空间的 webApiToken 通过', async () => {
        const result = await verifyWebCredential('the-web-token:my-ns')
        expect(result).not.toBeNull()
        expect(result?.namespace).toBe('my-ns')
    })

    test('webApiToken 配置本身含 ":" 后缀时，两端 baseToken 对齐仍可校验通过（回归锁定）', async () => {
        // 模拟手动设 WEB_API_TOKEN="base:ns"：两端都经 parseAccessToken 取 baseToken，
        // 避免 baseToken 与完整值错位导致永久 401
        process.env.WEB_API_TOKEN = 'the-web-token:web-ns'
        resetConfiguration()
        await createConfiguration()

        const result = await verifyWebCredential('the-web-token:web-ns')
        expect(result).not.toBeNull()
        expect(result?.namespace).toBe('web-ns')
    })
})
