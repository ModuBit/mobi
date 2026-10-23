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

// forked skill tap 生产端配置（spec forked-code-review-tap）：
// 独立 plugin 只观测 Claude Code 内置 /code-review 的 forked command 执行行——
// CLI 若改变 fork 行为，从 bundledPlugins 摘除本 plugin 即完全回退。
// 沙箱约束：hooks 模块禁止读任意文件，规则以 .mjs 模块形态随 plugin 分发。
// 与 shared 契约（packages/shared/src/forkedSkillTap.ts）的等值由 cli 测试锁定。

/** 接管的 forked skill：CLI 以 `/<skill> <args>` 作为 agent description */
export const targetSkill = 'code-review';

/** 监听的行门：只推模型响应与工具结果（attachment 等引擎注入行在 matcher 层挡掉） */
export const appendDoors = ['response', 'tool-result'];

/** bridge 信封 type（`<来源>.<事件>` 命名）：与 shared 的 FORKED_SKILL_TAP_ENVELOPE_TYPE 等值 */
export const envelopeType = 'forked-skill.append';

/** 单条 message 序列化上限（字符数近似字节）：超过截断并标记，防超大工具结果打爆 IPC */
export const maxMessageChars = 256 * 1024;
