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
 * CLI namespace 解析契约（发现 E）。
 * 此前回落 default 静默发生，鉴权/配置问题呈现为「没有可 fork 的会话」；
 * 锁定：正常解析、回落必须带 stderr 警告、读取失败同样回落 default。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@mobi/node-core/persistence', () => ({
    readSettings: vi.fn(),
    updateSettings: vi.fn()
}))

import { readSettings } from '@mobi/node-core/persistence'
import { configuration } from '@mobi/node-core/configuration'
import { resolveCliNamespace } from '@/commands/namespace'

const mockReadSettings = vi.mocked(readSettings)
let errorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
    configuration._setCliApiToken('')
    mockReadSettings.mockReset()
    mockReadSettings.mockResolvedValue({} as Awaited<ReturnType<typeof readSettings>>)
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    errorSpy.mockRestore()
    configuration._setCliApiToken('')
})

describe('resolveCliNamespace', () => {
    it('env token 携带 namespace → 取 namespace 且不告警', async () => {
        configuration._setCliApiToken('secret:work')

        await expect(resolveCliNamespace()).resolves.toBe('work')
        expect(errorSpy).not.toHaveBeenCalled()
    })

    it('env 为空回落 settings 的 token（优先级链走 resolveEffectiveCliToken 单源）', async () => {
        mockReadSettings.mockResolvedValue({ cliApiToken: 'tok:ns-file' } as Awaited<ReturnType<typeof readSettings>>)

        await expect(resolveCliNamespace()).resolves.toBe('ns-file')
        expect(errorSpy).not.toHaveBeenCalled()
    })

    it('env token 覆盖 settings（env 优先，否则查错 namespace）', async () => {
        configuration._setCliApiToken('env:ns-env')
        mockReadSettings.mockResolvedValue({ cliApiToken: 'settings:ns-file' } as Awaited<ReturnType<typeof readSettings>>)

        await expect(resolveCliNamespace()).resolves.toBe('ns-env')
    })

    it('无任何 token → 回落 default 且 stderr 有原因告警', async () => {
        await expect(resolveCliNamespace()).resolves.toBe('default')
        expect(errorSpy).toHaveBeenCalledTimes(1)
        expect(String(errorSpy.mock.calls[0]?.[0])).toContain('default')
    })

    it('token 形状无法解析出 namespace → 回落 default 且告警', async () => {
        configuration._setCliApiToken(':broken')

        await expect(resolveCliNamespace()).resolves.toBe('default')
        expect(errorSpy).toHaveBeenCalledTimes(1)
    })

    it('读取 settings 失败 → 回落 default 且告警带原因', async () => {
        mockReadSettings.mockRejectedValue(new Error('disk on fire'))

        await expect(resolveCliNamespace()).resolves.toBe('default')
        expect(errorSpy).toHaveBeenCalledTimes(1)
        expect(String(errorSpy.mock.calls[0]?.[0])).toContain('disk on fire')
    })
})
