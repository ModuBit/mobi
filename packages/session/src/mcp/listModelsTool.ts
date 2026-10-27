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
 * list_models 工具：让 agent 在派活前查到宿主真实的模型清单。
 *
 * **无入参**：清单取宿主默认配置目录——per-project 差异不足以支撑一个入参，调用方
 * 通常也还没有目录。返回**结构化 JSON 文本**而不是散文：模型名要能直接填进
 * create_session，档位/快速能力位要能直接判断，不该逼调用方再解析一遍自然语言。
 *
 * 失败文案**不由本工具拼**：目录探测失败是 daemon 侧的事实，那句「拿不到，但你可以
 * 填这些」由 AgentSessionService 写（唯一翻译点）。本工具只译自己产生的连接故障。
 */

import { z } from 'zod'
import type { AgentListModelsAck, ModelInfo } from '@mobi/shared'
import { errorTextResult, textResult, type MobiToolTextResult } from './toolResult'

export const LIST_MODELS_TOOL_NAME = 'list_models' as const

export interface ListModelsToolDeps {
    /** 读宿主模型目录（emitWithAck 等回执，见 ApiSessionClient.listModelsForAgent） */
    listModels: () => Promise<AgentListModelsAck>
}

/**
 * 给模型的字段是**契约**，不是 ModelInfo 的原样转储：只留能驱动 create_session 的
 * 那几项（`resolvedModel` 等 SDK 内部字段对调用方没有意义）。
 */
function toModelEntry(model: ModelInfo) {
    return {
        value: model.value,
        displayName: model.displayName,
        description: model.description,
        supportsEffort: model.supportsEffort,
        supportedEffortLevels: model.supportedEffortLevels,
        supportsFastMode: model.supportsFastMode,
    }
}

export function createListModelsTool(deps: ListModelsToolDeps) {
    // 无入参：宿主可能传空对象、也可能什么都不传，两者都照常执行
    async function execute(_rawArgs?: unknown): Promise<MobiToolTextResult> {
        let answer: AgentListModelsAck
        try {
            answer = await deps.listModels()
        } catch (error) {
            // socket 断开 / ack 超时：与 daemon 的业务失败（已翻译成人话）不同
            return errorTextResult('Failed to reach mobi daemon', error)
        }

        if (!answer.ok) {
            // daemon 已说清「为什么拿不到」与「还能填什么」，原样透出
            return { content: [{ type: 'text', text: answer.error }], isError: true }
        }

        return textResult(JSON.stringify({ models: answer.models.map(toModelEntry) }, null, 2))
    }

    return {
        name: LIST_MODELS_TOOL_NAME,
        description:
            'List the models this mobi host can run right now, as JSON. Each entry carries the value to pass to ' +
            'create_session plus its reasoning-effort levels and whether it supports fast mode. Takes no ' +
            'arguments. Use it before create_session when the work calls for a specific model or effort level; ' +
            'if the catalog cannot be probed, the error names the fallback values you can still pass.',
        title: 'List Models',
        inputSchema: z.object({}),
        execute,
    }
}

export type ListModelsTool = ReturnType<typeof createListModelsTool>
