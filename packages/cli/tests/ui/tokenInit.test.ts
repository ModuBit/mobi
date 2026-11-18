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

/**
 * 有效 CLI token 解析的单一来源契约（发现 E）。
 * tokenInit 与 namespace 此前各抄一份优先级链，env 覆盖 token 时 namespace 会
 * 查错 namespace；收口到 resolveEffectiveCliToken 后锁定优先级与来源标记。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@mobi/node-core/persistence', () => ({
    readSettings: vi.fn(),
    updateSettings: vi.fn()
}))

import { readSettings } from '@mobi/node-core/persistence'
import { configuration } from '@mobi/node-core/configuration'
import { resolveEffectiveCliToken } from '@/ui/tokenInit'

const mockReadSettings = vi.mocked(readSettings)

beforeEach(() => {
    configuration._setCliApiToken('')
    mockReadSettings.mockReset()
    mockReadSettings.mockResolvedValue({} as Awaited<ReturnType<typeof readSettings>>)
})

afterEach(() => {
    configuration._setCliApiToken('')
})

describe('resolveEffectiveCliToken', () => {
    it('env（configuration.cliApiToken）优先，且不读 settings', async () => {
        configuration._setCliApiToken('env-token:ns-env')

        await expect(resolveEffectiveCliToken()).resolves.toEqual({
            token: 'env-token:ns-env',
            source: 'env'
        })
        expect(mockReadSettings).not.toHaveBeenCalled()
    })

    it('env 为空回落 settings.cli.json，来源标记 settings', async () => {
        mockReadSettings.mockResolvedValue({ cliApiToken: 'settings-token:ns-file' } as Awaited<ReturnType<typeof readSettings>>)

        await expect(resolveEffectiveCliToken()).resolves.toEqual({
            token: 'settings-token:ns-file',
            source: 'settings'
        })
    })

    it('两处皆缺 → null', async () => {
        await expect(resolveEffectiveCliToken()).resolves.toBeNull()
    })
})
