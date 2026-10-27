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
 * list_models 的行为契约：
 * ① 无入参，返回结构化 JSON（模型名可直接填进 create_session，能力位可直接判断）；
 * ② 只暴露调用方用得上的字段，不把 SDK 内部字段整包转储；
 * ③ daemon 的失败文案原样透出（唯一翻译点），连接故障自己译。
 */

import { describe, it, expect, vi } from 'vitest'
import { createListModelsTool, LIST_MODELS_TOOL_NAME } from '@/mcp/listModelsTool'
import type { ModelInfo } from '@mobi/shared'

const MODELS: ModelInfo[] = [
    {
        value: 'opus',
        resolvedModel: 'claude-opus-4-8',
        displayName: 'Opus',
        description: '最强',
        supportsEffort: true,
        supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
        supportsFastMode: true,
    },
]

function buildDeps(answer: unknown = { ok: true, models: MODELS }) {
    const listModels = vi.fn().mockResolvedValue(answer)
    return { deps: { listModels }, listModels }
}

describe('createListModelsTool', () => {
    it('exposes stable tool identity for mcp__mobi-apps__list_models prefix', () => {
        const { deps } = buildDeps()
        const tool = createListModelsTool(deps)

        expect(tool.name).toBe(LIST_MODELS_TOOL_NAME)
        expect(tool.name).toBe('list_models')
    })

    it('takes no arguments', async () => {
        const { deps, listModels } = buildDeps()
        const tool = createListModelsTool(deps)

        // 宿主可能传空对象、也可能什么都不传
        await tool.execute({})
        await tool.execute()

        expect(listModels).toHaveBeenCalledTimes(2)
    })

    it('returns JSON with the fields that drive create_session', async () => {
        const { deps } = buildDeps()
        const tool = createListModelsTool(deps)

        const result = await tool.execute()

        expect(result.isError).toBe(false)
        const parsed = JSON.parse(result.content[0].text) as { models: Array<Record<string, unknown>> }
        expect(parsed.models).toEqual([{
            value: 'opus',
            displayName: 'Opus',
            description: '最强',
            supportsEffort: true,
            supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
            supportsFastMode: true,
        }])
        // SDK 内部字段不是给调用方的契约
        expect(parsed.models[0]).not.toHaveProperty('resolvedModel')
    })

    it('description points the caller at create_session', () => {
        const { deps } = buildDeps()

        expect(createListModelsTool(deps).description).toContain('create_session')
    })

    it('passes the daemon\'s plain-language failure through unwrapped', async () => {
        const message = 'The host model catalog is unavailable (probe timed out). You can still create sessions: omit model to take the default.'
        const { deps } = buildDeps({ ok: false, error: message })
        const tool = createListModelsTool(deps)

        const result = await tool.execute()

        expect(result.isError).toBe(true)
        expect(result.content[0].text).toBe(message)
    })

    it('treats an ack timeout / socket error as a connection failure', async () => {
        const listModels = vi.fn().mockRejectedValue(new Error('operation has timed out'))
        const tool = createListModelsTool({ listModels })

        const result = await tool.execute()

        expect(result.isError).toBe(true)
        expect(result.content[0].text).toContain('Failed to reach mobi daemon')
        expect(result.content[0].text).toContain('timed out')
    })
})
