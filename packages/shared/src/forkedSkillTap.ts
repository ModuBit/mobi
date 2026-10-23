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

// forked skill tap 的生产/消费契约单源（spec forked-code-review-tap）：
// mod 侧（独立 plugin `mobi-forked-tap`）把 forked /code-review 的非 text 行以最小
// 事实推过 bridge；session 侧据此拼主对话行，并在 SDK 流入口做去重与 text 抑制。
// 信封 type 统一 `<来源>.<事件>` 命名，与 goal 通道（goal.append）并列，禁止同义混用。
// mod 生产端是 mods 沙箱零 import 的物理资产，与本文件常量的等值由 cli 测试锁定。

import { z } from 'zod'
import { isObject } from './utils'

/** 信封 type：fork 行实时上报（bridge 按 type 精确路由） */
export const FORKED_SKILL_TAP_ENVELOPE_TYPE = 'forked-skill.append'

/** 当前接管的 forked skill：只覆盖 Claude Code 内置 /code-review */
export const FORKED_SKILL_TAP_SKILL = 'code-review'

/** CLI 给 forked command 行的 parent_tool_use_id 前缀；code-review 的完整值 */
const FORKED_COMMAND_PARENT_PREFIX = 'forked-command-'
export const CODE_REVIEW_FORK_PARENT_ID = `${FORKED_COMMAND_PARENT_PREFIX}${FORKED_SKILL_TAP_SKILL}`

/** 监听的行门（door = 行进入会话的路由）：只推模型响应与工具结果，attachment 等噪音不进 hook */
export const FORKED_SKILL_TAP_DOORS = ['response', 'tool-result'] as const
export type ForkedSkillTapDoor = (typeof FORKED_SKILL_TAP_DOORS)[number]

/**
 * fork 行上报载荷（mod 侧最小事实，不拼业务行）：
 * skill 锁定 code-review；uuid 供 session 去重与流侧抑制；message 是 fork 行的原始
 * message（assistant/user 形态，content 为 block 数组），session 侧再补 envelope 字段。
 */
export const ForkedSkillAppendPayloadSchema = z.object({
    skill: z.literal(FORKED_SKILL_TAP_SKILL),
    uuid: z.string().min(1),
    door: z.enum(FORKED_SKILL_TAP_DOORS),
    message: z.object({ content: z.array(z.unknown()) }).loose(),
    /** 单条 message 序列化超过 256KB 时截断并置 true（content 仅保留前缀） */
    truncated: z.boolean().optional(),
})
export type ForkedSkillAppendPayload = z.infer<typeof ForkedSkillAppendPayloadSchema>

/** SDK 流消息的最小判别面（uuid / fork 归属 / 正文） */
export interface StreamMessageShape {
    uuid?: string | null
    parent_tool_use_id?: string | null
    /** 行正文；SDK 各消息形态不一（可能为字符串或缺失），非对象视为无 text 内容 */
    message?: unknown
}

/** 从任意形态的 message 取出 content（非对象 / 缺失 → undefined） */
function messageContent(message: unknown): unknown {
    return isObject(message) ? message.content : undefined
}

/** content 是否全部为 text block（字符串视为 text；空数组不算——空消息无意义） */
function isTextOnlyContent(content: unknown): boolean {
    if (typeof content === 'string') return true
    if (!Array.isArray(content) || content.length === 0) return false
    return content.every((block) => (block as { type?: unknown } | null)?.type === 'text')
}

/**
 * SDK 流消息是否应被抑制（该内容已由实时行接管，流末尾的批量重放只会有害）：
 * 1. uuid 已在实时行集合中 → 丢弃（实测流末尾 fork 消息与事件的 uuid 完全一致）
 * 2. code-review fork 的纯 text 消息 → 丢弃（该行与主循环最终答复重复，uuid 却不同）
 * 其他 forked skill 与普通子代理不受影响。
 */
export function shouldSuppressStreamMessage(message: StreamMessageShape, seenUuids: ReadonlySet<string>): boolean {
    if (message.uuid && seenUuids.has(message.uuid)) return true
    if (message.parent_tool_use_id === CODE_REVIEW_FORK_PARENT_ID && isTextOnlyContent(messageContent(message.message))) {
        return true
    }
    return false
}
