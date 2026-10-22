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

/** session.append 事件的推送规则：命中任一规则即把信号推过桥 */
export const sessionAppendRules = [
    { door: 'attachment', name: 'goal_status' },
];
