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
 * 模型名 → 上下文窗口大小的**猜测值**。
 *
 * 窗口大小是 Claude Code 内部的模型配置知识，SDK 不透出；权威来源只有
 * result.modelUsage[model].contextWindow（turn 结束才到达）。本函数按命名约定预填，
 * 让首 turn / resume 后的实时水位上报不必等第一个 result：
 * - 名字含 `[1m]`（忽略大小写）→ 1M 窗口
 * - 其余一律 200k（claude 标准窗口；未知网关模型名也按此猜，宁可显示不精确也不全程缺席）
 *
 * 猜错无害：result 到达时 calcContextUsageFromResult 用真实 contextWindow 覆盖记忆，
 * 偏差只存在于首个 result 之前。窗口档位若出新规格（如 [2m]），在此追加分支。
 */
export function guessContextWindow(model: string | undefined): number | undefined {
    if (!model) return undefined
    return /\[1m\]/i.test(model) ? 1_000_000 : 200_000
}
