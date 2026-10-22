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

// 消息受理点的 goal 派生（mods-goal-channel 票 03，spec「daemon 侧派生」）：
// 受理发现 attachment.goal_status 原始行 → 投影 runtimeState.goalStatus——
// 进行中（met:false）写入 GoalStatus，达成（met:true）返回清空投影。
// goal 呈现逻辑收敛在 daemon 派生 + web 渲染，session 零语义。

import { unwrapOutputMessage } from '@mobi/shared/messages'
import { parseGoalStatusAttachment, type GoalStatus } from '@mobi/shared/schemas'

/** goal 投影产出：goalStatus 缺省 = 达成清空（调用方删字段，达成态不驻留吊顶） */
export interface GoalStatusProjection {
    goalStatus?: GoalStatus
}

/**
 * 从受理消息 content 提取 goal_status 投影。
 * 非该类型的行零开销：envelope 解包后两级 type 判断即返回 null，不触载荷解析。
 */
export function extractGoalStatusFromMessageContent(content: unknown): GoalStatusProjection | null {
    // envelope 解包走 shared 单源（unwrapOutputMessage：envelope 格式演进只改一处）；
    // 非该类型的行两级 type 判断即返回 null，不触载荷解析
    const unwrapped = unwrapOutputMessage(content)
    if (!unwrapped || unwrapped.role !== 'agent') return null

    const data = unwrapped.data as { type?: unknown; attachment?: unknown }
    if (data.type !== 'attachment') return null

    // met:true → 清空投影（无 goalStatus 键）；进行中 → 完整 GoalStatus（sentinel
    // 由 schema strip，不进 runtimeState）。载荷口径 shared 单源（web 标注同口径）
    const goal = parseGoalStatusAttachment(data.attachment)
    if (!goal) return null
    return goal.met ? {} : { goalStatus: goal }
}
