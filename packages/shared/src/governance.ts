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
 * 会话治理快照（session-lifecycle-rewrite 票 1.2）：session 进程随 2s volatile
 * session-alive 心跳搭车上报的水位事实，供 daemon 侧 SessionRegistry 登记——
 * 后续 Governor（迭代二）据此做预算决策（LRU 排序、选逐出受害者、内存分级）。
 *
 * 边界（dormancy spec 裁决不变）：治理快照只做预算参考，**不参与** dormancy gate
 * 判定——gate 仍只在会话进程本地求值。volatile 语义（断线丢弃、下一拍再报）与
 * 「连续采样不是事件」的心跳定位吻合，丢拍无害。
 */

import { z } from 'zod'

/**
 * 休眠阻塞项（dormancy gate 四项事实的枚举单源；原 dormancyGate.ts 的
 * DormancyBlocker 迁移至此——治理快照与 gate 判定共用同一词汇）。
 */
export const DormancyBlockerSchema = z.enum([
    'pending_permissions',
    'queued_messages',
    'turn_running',
    'background_tasks',
])
export type DormancyBlocker = z.infer<typeof DormancyBlockerSchema>

/** 会话治理状态：active = turn 运行中；idle = 空闲（含阻塞复查中） */
export const SessionGovernanceStateSchema = z.enum(['active', 'idle'])

/**
 * 治理水位快照（session-alive 心跳搭车字段）。
 * - lastActivityAt：LRU 逐出的排序键（IdleTimer 的最近真实活动时刻）
 * - gateBlockers：此刻的休眠阻塞项（逐出前确认受害者真的闲；turn 运行中绝不可逐）
 * - rss：进程内存（内存分级用；按 N 拍抽稀，缺省 = 本拍未采样）
 */
export const SessionGovernanceSnapshotSchema = z.object({
    state: SessionGovernanceStateSchema,
    lastActivityAt: z.number(),
    gateBlockers: z.array(DormancyBlockerSchema),
    rss: z.number().optional(),
})
export type SessionGovernanceSnapshot = z.infer<typeof SessionGovernanceSnapshotSchema>
