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
 * 模型切换时间线事件（mobi 合成的 system 行）的单一契约声明（ADR 0002：消息词汇归 shared）。
 *
 * 为什么收成 codec：此前这条事件族的字符串契约散在五处各维护一份——
 * - CLI 合成端（session/runClaude）：`system` + subtype `model_change` + `model` 字段；
 * - 写库分类（shared/messageClassification）：读路径可见白名单里的 `model_change`；
 * - web normalize：注册表键 `system:model_change` 与取值字段 `model`；
 * - web 事件类型（domain/chat/types）：判别串 `model-change`；
 * - web 渲染（eventFormatter / reducerTimeline）：再次手写 `model-change`。
 * 字段或子类型变更要同步改五处、漏一处就静默丢行。本模块是这五点唯一的事实源：
 * subtype / payload schema / 合成构造 / 解析 / web 事件判别串都在这里声明。
 *
 * 合成端纪律：模型标识必须在**切换受理时快照**后传进来——不要在异步落地回调里读
 * 可变的会话当前模型（连续快速切换会把先一次的行标成后一次的模型，甚至发出重复语义行）。
 */

import { z } from 'zod'

/** wire 契约：system 消息的 subtype（CC 行兼容字段） */
export const MODEL_CHANGE_SYSTEM_SUBTYPE = 'model_change'

/** 聊天流事件判别串（web AgentEvent 的 type；与 wire subtype 有意不同形） */
export const MODEL_CHANGE_EVENT_TYPE = 'model-change'

/** 合成行 schema：只声明 mobi 写入的字段；其它字段（未来扩展）透传 */
export const ModelChangeLineSchema = z.object({
    type: z.literal('system'),
    subtype: z.literal(MODEL_CHANGE_SYSTEM_SUBTYPE),
    /** 切换后的模型标识（web 渲染端按语言拼装文案，行内只带标识） */
    model: z.string().min(1),
    /** 行标识：合成端必带；读路径兼容历史行缺失 */
    uuid: z.string().optional(),
}).passthrough()

export type ModelChangeLine = z.infer<typeof ModelChangeLineSchema>

/**
 * 合成端唯一入口：调用方在切换受理时快照模型标识后调用。
 * 落库分类不需要额外规则（system/model_change 默认 persistent），
 * 可见性白名单由 messageClassification 引用 {@link MODEL_CHANGE_SYSTEM_SUBTYPE}。
 */
export function buildModelChangeLine(input: { model: string; uuid: string }): ModelChangeLine {
    return {
        type: 'system',
        subtype: MODEL_CHANGE_SYSTEM_SUBTYPE,
        model: input.model,
        uuid: input.uuid,
    }
}

/** 消费端唯一入口：不匹配返回 null（字段名与形状不再由各消费方各自猜） */
export function parseModelChangeLine(row: unknown): { model: string } | null {
    const parsed = ModelChangeLineSchema.safeParse(row)
    return parsed.success ? { model: parsed.data.model } : null
}
