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

// transcript tap 生产端过滤规则（spec mods-goal-channel 基建①）：随包分发、
// 所有会话一致——调整监听面只改此文件，不改 register 转发逻辑、不进 env。
// 字段缺省 = 通配。mods 沙箱禁止 hooks 模块读任意文件（node:fs / JSON import
// 均不允许），故规则文件以 .mjs 模块形态分发（官方校验器认可的自家文件 import）。

/** 推往 bridge 的信封 type（`<来源>.<事件>` 命名）缺省值。历史单信封形态的回落——
 *  规则自带 envelope 字段时优先用规则的。与 shared 契约单源
 *  （TRANSCRIPT_TAP_GOAL_ENVELOPE_TYPE）等值由 cli 测试锁定——改 type 两处同步。 */
export const bridgeEnvelopeType = 'goal.append';

/** session.append 事件的推送规则：命中任一规则的 trigger 即把信号推过桥（信封按
 *  规则的 envelope 字段路由，缺省回落 bridgeEnvelopeType）。与 shared 契约单源
 *  （TRANSCRIPT_TAP_SESSION_APPEND_RULES）等值由 cli 测试锁定
 *  （mobiPluginHooks.test.ts）——改规则两处同步。
 *
 *  trigger/row 双匹配器（CC 2.1.312 探针实证）：session.append 事件是落盘序列化
 *  前的输入（形状 {message,door,origin,uuid}，wakeupSource 等字段落盘时才盖上），
 *  生产端只能按宽触发面发信号；落盘行的权威判定在消费端（row 匹配）。
 *
 *  - goal_status：CC 的 goal 吊顶 attachment 行（事件即行形状，row 缺省同 trigger）
 *  - wakeup：CC 内建 ScheduleWakeup//loop/Cron 自醒回合的注入 user 行
 *   （落盘行 `{type:'user', wakeupSource:'loop_wakeup', isMeta:true}`；事件层
 *   与人工 prompt 元数据完全同形（door='prompt'），只能宽触发 + 消费端按
 *   wakeupSource 权威判定，人工 prompt 行无该字段天然排除） */
export const sessionAppendRules = [
    { trigger: { door: 'attachment', name: 'goal_status' }, envelope: 'goal.append' },
    { trigger: { door: 'prompt' }, row: { door: 'user', field: 'wakeupSource' }, envelope: 'wakeup.append' },
];
