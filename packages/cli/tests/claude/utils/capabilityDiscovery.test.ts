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

import { describe, it, expect, vi } from 'vitest'
import { discoverCapabilities } from '../../../src/claude/utils/capabilityDiscovery'

vi.mock('@/ui/logger', () => ({
    logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

/** 构造三方法 Query 替身 */
function makeQuery(overrides: Record<string, unknown> = {}) {
    return {
        initializationResult: vi.fn().mockResolvedValue({ commands: [], agents: [], models: [] }),
        supportedModels: vi.fn().mockResolvedValue([{ value: 'sonnet', displayName: 'Sonnet', description: '' }]),
        supportedCommands: vi.fn().mockResolvedValue([{ name: 'compact', description: '', argumentHint: '' }]),
        supportedAgents: vi.fn().mockResolvedValue([{ name: 'Explore', description: '' }]),
        ...overrides,
    }
}

describe('discoverCapabilities（spec 批次 G U-27）', () => {
    it('成功路径：initializationResult 后并行调三方法，onCapabilities 收到三件套', async () => {
        const query = makeQuery()
        const onCapabilities = vi.fn()

        await discoverCapabilities(query as never, onCapabilities)

        expect(query.initializationResult).toHaveBeenCalledTimes(1)
        expect(query.supportedModels).toHaveBeenCalledTimes(1)
        expect(query.supportedCommands).toHaveBeenCalledTimes(1)
        expect(query.supportedAgents).toHaveBeenCalledTimes(1)
        expect(onCapabilities).toHaveBeenCalledTimes(1)
        expect(onCapabilities).toHaveBeenCalledWith({
            models: [{ value: 'sonnet', displayName: 'Sonnet', description: '' }],
            commands: [{ name: 'compact', description: '', argumentHint: '' }],
            agents: [{ name: 'Explore', description: '' }],
            outputStyle: undefined,
            availableOutputStyles: undefined,
        })
    })

    it('init 携带 output_style / available_output_styles → 透传进能力面（web 切换器数据源，CC 规范形）', async () => {
        const query = makeQuery({
            initializationResult: vi.fn().mockResolvedValue({
                commands: [], agents: [], models: [],
                output_style: 'Proactive',
                available_output_styles: ['default', 'Proactive', 'Concise'],
            }),
        })
        const onCapabilities = vi.fn()

        await discoverCapabilities(query as never, onCapabilities)

        expect(onCapabilities).toHaveBeenCalledWith(
            expect.objectContaining({
                outputStyle: 'Proactive',
                availableOutputStyles: ['default', 'Proactive', 'Concise'],
            }),
        )
    })

    it('initializationResult 拒绝 → onCapabilities 不被调、不向上抛（失败静默）', async () => {
        const query = makeQuery({ initializationResult: vi.fn().mockRejectedValue(new Error('timeout')) })
        const onCapabilities = vi.fn()

        await expect(discoverCapabilities(query as never, onCapabilities)).resolves.toBeUndefined()
        expect(onCapabilities).not.toHaveBeenCalled()
        // 三方法不应在 init 失败后被调用
        expect(query.supportedModels).not.toHaveBeenCalled()
    })

    it('三方法任一拒绝 → onCapabilities 不被调、不向上抛', async () => {
        const query = makeQuery({ supportedAgents: vi.fn().mockRejectedValue(new Error('boom')) })
        const onCapabilities = vi.fn()

        await expect(discoverCapabilities(query as never, onCapabilities)).resolves.toBeUndefined()
        expect(onCapabilities).not.toHaveBeenCalled()
    })

    it('三方法全部返回空数组 → 不回调 onCapabilities（空结果守卫，保旧快照）', async () => {
        const query = makeQuery({
            supportedModels: vi.fn().mockResolvedValue([]),
            supportedCommands: vi.fn().mockResolvedValue([]),
            supportedAgents: vi.fn().mockResolvedValue([]),
        })
        const onCapabilities = vi.fn()

        await discoverCapabilities(query as never, onCapabilities)

        expect(onCapabilities).not.toHaveBeenCalled()
    })

    it('部分为空（models 空但 commands 有值）→ 正常回调（仅全空才守卫）', async () => {
        const query = makeQuery({ supportedModels: vi.fn().mockResolvedValue([]) })
        const onCapabilities = vi.fn()

        await discoverCapabilities(query as never, onCapabilities)

        expect(onCapabilities).toHaveBeenCalledTimes(1)
        expect(onCapabilities).toHaveBeenCalledWith({
            models: [],
            commands: [{ name: 'compact', description: '', argumentHint: '' }],
            agents: [{ name: 'Explore', description: '' }],
            outputStyle: undefined,
            availableOutputStyles: undefined,
        })
    })
})
