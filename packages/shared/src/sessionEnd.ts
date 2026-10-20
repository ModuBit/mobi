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
 * 会话终结原因（session-lifecycle-rewrite 票 1.1）：所有会话进程退出路径的统一枚举，
 * 经 session-end 事件上报 daemon，落库 sessions.end_state 单列（JSON：reason/trigger/at）——
 * daemon 与 Web 据此区分「休眠可唤醒」与「已终结」。
 *
 * 语义边界：SessionEndReason 回答「会话为什么结束」，与 LocalLaunchExitReason
 * （为什么没起来，启动失败语境）不同名不同义，勿混用。
 *
 * pause 与其余 reason 的进程层动作完全相同（都是退出），差别只在契约：
 * pause = 可复活（daemon 保留唤醒标记，warm-on-open 供数）。
 */

import { z } from 'zod'

/**
 * - stop：用户/daemon 主动终止（kill RPC、SIGTERM/SIGINT、启动失败收尾）
 * - pause：休眠（可复活）——idle_timeout / disconnect_timeout / manual / governor_evict
 * - archive：daemon 侧归档（会话进程本身按 stop 退出，此值由 daemon 写行）
 * - delete：daemon 侧删档（同上）
 * - crash：进程未捕获异常 / unhandledRejection（markCrash）
 */
export const SessionEndReasonSchema = z.enum(['stop', 'pause', 'archive', 'delete', 'crash'])
export type SessionEndReason = z.infer<typeof SessionEndReasonSchema>

/** pause 的触发来源（结构化落库，供遥测与 warm-on-open 判定） */
export const SessionPauseTriggerSchema = z.enum([
    'idle_timeout',
    'disconnect_timeout',
    'governor_evict',
    'manual',
])
export type SessionPauseTrigger = z.infer<typeof SessionPauseTriggerSchema>

/**
 * killSession RPC 的可选终结语义（daemon → 会话进程）：两端共用一份形状——
 * 此前发送端与接收端各写一份，字段漂移不会被任一侧编译期发现。
 */
export type SessionKillRequest = {
    endReason?: SessionEndReason
    pauseTrigger?: SessionPauseTrigger
}
