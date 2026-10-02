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
 * ⚠️ 修正前提：仅当 result.modelUsage 携带 contextWindow 时猜测才被真实值覆盖；
 * 渠道不返回该字段时（部分第三方网关），calcContextUsageFromResult 的
 * `main?.contextWindow || lastMaxTokens` 会回退到猜测值本身——错误读数整个会话生效、
 * 无法自愈。此为已知的「宁显示不错缺席」取舍（用户拍板），改进方向见 docs/pending.md #57。
 * 窗口档位若出新规格（如 [2m]），在此追加分支。
 */
export function guessContextWindow(model: string | undefined): number | undefined {
    if (!model) return undefined
    return /\[1m\]/i.test(model) ? 1_000_000 : 200_000
}
