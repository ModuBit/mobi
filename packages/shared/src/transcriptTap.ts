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

// transcript tap 的生产/消费契约单源（mods-goal-channel）：
// 「mod 生产端过滤什么事件」与「session 消费端认哪些行」是同一契约的两个半份，
// 曾经在 config.mjs（cli 插件资产）与 goalTapSubscriber（session）三处字面量双写。
// 现收敛于此：消费端直接由常量推导匹配；生产端 config.mjs 是 mods 沙箱零 import
// 的物理资产（开发态源目录即挂载点，无法生成），与常量的等值由 cli 测试锁定
// （mobiPluginHooks.test.ts）——漂移从「测试才能发现」变「测试必失败」。

import { parseGoalStatusAttachment } from './schemas'

/**
 * goal tap 推往 bridge 的信封 type，统一 `<来源>.<事件>` 命名。
 * 通道按 type 精确路由，禁止与 mods 事件同名（否则「goal 订阅者收到 fork 事件」
 * 这类跨源串台只能靠订阅者自己兜）。
 * 生产端 config.mjs 是 mods 沙箱零 import 的物理资产，与常量的等值由 cli 测试锁定。
 */
export const TRANSCRIPT_TAP_GOAL_ENVELOPE_TYPE = 'goal.append'

/** session.append 事件的 tap 订阅规则（字段缺省 = 通配） */
export interface TranscriptTapSessionAppendRule {
    /** 事件的 door（行进入会话的路由，如 attachment） */
    door?: string
    /** attachment 类型名（载荷自身的 type 字段，如 goal_status） */
    name?: string
}

/**
 * 当前订阅：仅 goal_status 观测（goal 吊顶 + 聊天流标注）。
 * 新增 tap 消费者时在此追加规则——消费端匹配自动跟上，无需新机制。
 */
export const TRANSCRIPT_TAP_SESSION_APPEND_RULES: readonly TranscriptTapSessionAppendRule[] = [
    { door: 'attachment', name: 'goal_status' },
]

/**
 * attachment 载荷校验注册表（按类型名）：管道侧的 generic 载荷 schema
 * （session claude/types 的 AttachmentPayloadSchema）据此分发校验——新 attachment
 * 消费者在此追加条目即全链路（tap 识别 + 载荷校验）跟上，管道 schema 零特判、
 * 保持零业务语义。未注册的类型名同样静默跳过（注册即「持久化 + 广播」白名单：
 * tap 只认注册类型，未注册行无人消费，放行只会无界扩大广播面）。
 */
export const TRANSCRIPT_TAP_ATTACHMENT_VALIDATORS: Readonly<Record<string, (value: unknown) => boolean>> = {
    goal_status: (value) => parseGoalStatusAttachment(value) !== null,
}
