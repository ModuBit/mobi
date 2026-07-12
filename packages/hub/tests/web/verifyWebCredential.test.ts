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
import { resetConfiguration, createConfiguration } from '../../src/configuration'
import { verifyWebCredential } from '../../src/web/auth/verifyWebCredential'

describe('verifyWebCredential', () => {
    beforeEach(async () => {
        process.env.WEB_API_TOKEN = 'the-web-token'
        process.env.CLI_API_TOKEN = 'the-cli-token'
        resetConfiguration()
        await createConfiguration()
    })

    afterEach(() => {
        delete process.env.WEB_API_TOKEN
        delete process.env.CLI_API_TOKEN
        resetConfiguration()
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
})
