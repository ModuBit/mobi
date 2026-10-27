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
 * 能力目录：活 Query 投影 + per-cwd 缓存（fresh/SWR/签名/single-flight/LRU）。
 */

import { describe, it, expect, vi } from 'vitest'
import {
    createCapabilityCatalog,
    readFastModeState,
    readLiveCapabilities,
    type LiveCapabilitySource,
} from '@/claudeSdk/capabilityCatalog'

vi.mock('@mobi/node-core/logger', () => ({
    logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

const META = {
    commands: [{ name: 'compact', description: 'Compact', argumentHint: '' }],
    agents: [{ name: 'Explore', description: 'Search' }],
    models: [{ value: 'sonnet', displayName: 'Sonnet', description: '' }],
}

function makeSource(overrides: Partial<LiveCapabilitySource> = {}): LiveCapabilitySource {
    return {
        initializationResult: vi.fn().mockResolvedValue({
            output_style: 'auto',
            available_output_styles: ['auto', 'dark'],
            account: { email: 'a@b.c' },
            fast_mode_state: 'off',
        }),
        supportedModels: vi.fn().mockResolvedValue(META.models),
        supportedCommands: vi.fn().mockResolvedValue(META.commands),
        supportedAgents: vi.fn().mockResolvedValue(META.agents),
        ...overrides,
    }
}

describe('readFastModeState', () => {
    it('优先 reinitialize（新鲜值），不碰 initializationResult 快照', async () => {
        const initializationResult = vi.fn().mockResolvedValue({ fast_mode_state: 'off' })
        const reinitialize = vi.fn().mockResolvedValue({ fast_mode_state: 'on' })
        const source = makeSource({ initializationResult, reinitialize })

        await expect(readFastModeState(source)).resolves.toEqual({ state: 'on' })
        expect(initializationResult).not.toHaveBeenCalled()
    })

    it('源不支持 reinitialize 时回落启动快照', async () => {
        await expect(readFastModeState(makeSource())).resolves.toEqual({ state: 'off' })
    })

    it('携带不可用原因', async () => {
        const source = makeSource({
            reinitialize: vi.fn().mockResolvedValue({ fast_mode_state: 'off', fast_mode_disabled_reason: 'free' }),
        })

        await expect(readFastModeState(source)).resolves.toEqual({ state: 'off', reason: 'free' })
    })

    it('SDK 未给状态字段（老版本 / 非 fast 模型）→ null，调用方保持上一次值', async () => {
        const source = makeSource({ reinitialize: vi.fn().mockResolvedValue({}) })

        await expect(readFastModeState(source)).resolves.toBeNull()
    })
})

describe('readLiveCapabilities', () => {
    it('投影完整 SDKMetadata（含 account / fastModeState）', async () => {
        await expect(readLiveCapabilities(makeSource())).resolves.toEqual({
            commands: META.commands,
            agents: META.agents,
            models: META.models,
            outputStyle: 'auto',
            availableOutputStyles: ['auto', 'dark'],
            account: { email: 'a@b.c' },
            fastModeState: 'off',
        })
    })

    it('三件套全空 → 抛错（调用方据此回退探针）', async () => {
        const source = makeSource({
            supportedModels: vi.fn().mockResolvedValue([]),
            supportedCommands: vi.fn().mockResolvedValue([]),
            supportedAgents: vi.fn().mockResolvedValue([]),
        })
        await expect(readLiveCapabilities(source)).rejects.toThrow('empty set')
    })

    it('init 失败 → 不调三方法并向上抛', async () => {
        const source = makeSource({ initializationResult: vi.fn().mockRejectedValue(new Error('boom')) })
        await expect(readLiveCapabilities(source)).rejects.toThrow('boom')
        expect(source.supportedCommands).not.toHaveBeenCalled()
    })
})

describe('createCapabilityCatalog', () => {
    function setup(options: { maxEntries?: number } = {}) {
        const clock = { now: 0 }
        const probe = vi.fn(async () => META)
        const signatureState = { value: 'sig-1' as string | null }
        const signature = vi.fn(async () => signatureState.value)
        const catalog = createCapabilityCatalog({
            probe,
            signature,
            now: () => clock.now,
            freshMs: 30_000,
            staleMs: 600_000,
            maxEntries: options.maxEntries,
        })
        return { catalog, probe, signature, clock, signatureState }
    }

    it('30 秒内命中缓存，不再探测', async () => {
        const { catalog, probe, clock } = setup()

        await catalog.get('/tmp/cap-a')
        clock.now = 29_000
        await catalog.get('/tmp/cap-a')

        expect(probe).toHaveBeenCalledTimes(1)
    })

    it('过期但签名未变 → 先返回旧值，后台重探一次', async () => {
        const { catalog, probe, clock } = setup()

        await catalog.get('/tmp/cap-a')
        clock.now = 31_000
        const result = await catalog.get('/tmp/cap-a')

        expect(result).toEqual(META)
        await vi.waitFor(() => expect(probe).toHaveBeenCalledTimes(2))
    })

    it('过期且签名变化 → 等待重探', async () => {
        const { catalog, probe, clock, signatureState } = setup()

        await catalog.get('/tmp/cap-a')
        clock.now = 31_000
        signatureState.value = 'sig-2'
        await catalog.get('/tmp/cap-a')

        expect(probe).toHaveBeenCalledTimes(2)
    })

    it('超过 stale 窗口 → 等待重探', async () => {
        const { catalog, probe, clock } = setup()

        await catalog.get('/tmp/cap-a')
        clock.now = 600_001
        await catalog.get('/tmp/cap-a')

        expect(probe).toHaveBeenCalledTimes(2)
    })

    it('并发请求合并成一次探测（single-flight）', async () => {
        const { catalog, probe } = setup()

        await Promise.all([
            catalog.get('/tmp/cap-a'),
            catalog.get('/tmp/cap-a'),
            catalog.get('/tmp/cap-a'),
        ])

        expect(probe).toHaveBeenCalledTimes(1)
    })

    it('探测失败且仍在 stale 窗口 → 返回旧值', async () => {
        const { catalog, probe, clock, signatureState } = setup()

        await catalog.get('/tmp/cap-a')
        clock.now = 31_000
        signatureState.value = 'sig-2'
        probe.mockRejectedValueOnce(new Error('probe down'))

        await expect(catalog.get('/tmp/cap-a')).resolves.toEqual(META)
    })

    it('探测失败且超出 stale 窗口 → 上抛', async () => {
        const { catalog, probe, clock } = setup()

        await catalog.get('/tmp/cap-a')
        clock.now = 600_001
        probe.mockRejectedValueOnce(new Error('probe down'))

        await expect(catalog.get('/tmp/cap-a')).rejects.toThrow('probe down')
    })

    it('签名不可读（null）→ 保守按变化处理', async () => {
        const { catalog, probe, clock, signatureState } = setup()

        await catalog.get('/tmp/cap-a')
        clock.now = 31_000
        signatureState.value = null
        await catalog.get('/tmp/cap-a')

        expect(probe).toHaveBeenCalledTimes(2)
    })

    it('LRU：超过上限淘汰最久未用条目', async () => {
        const { catalog, probe } = setup({ maxEntries: 2 })

        await catalog.get('/tmp/cap-a')
        await catalog.get('/tmp/cap-b')
        await catalog.get('/tmp/cap-a') // 触达 a，b 成为最久未用
        await catalog.get('/tmp/cap-c')

        probe.mockClear()
        await catalog.get('/tmp/cap-b')
        expect(probe).toHaveBeenCalledTimes(1)
    })

    it('invalidate 后下一次 get 重新探测', async () => {
        const { catalog, probe } = setup()

        await catalog.get('/tmp/cap-a')
        catalog.invalidate('/tmp/cap-a')
        await catalog.get('/tmp/cap-a')

        expect(probe).toHaveBeenCalledTimes(2)
    })
})
