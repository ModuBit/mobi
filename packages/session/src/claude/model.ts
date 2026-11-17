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

import { DEFAULT_MODEL } from '@mobi/shared'
import type { SessionModel } from '@mobi/node-core/api/types'

/**
 * CC 的「宿主默认模型」别名。
 *
 * CC 模型目录里默认项的 value 恒为 `default`（displayName 形如 `Default (recommended)`），
 * `/model` 选择器与 `set_model` 控制请求都吃这个别名。mobi 的 DEFAULT_MODEL（'auto'）
 * 只是 UI 哨兵，**不是** CC 模型 id：`set_model` 按模型 id 形状校验（拒绝原因枚举含
 * `catalog_unknown`），把哨兵直送会静默失败——live 切换不落地、也不落 model_change
 * 时间线行（2026-11-17 真机实证：真实模型切换成功、切回 Auto 无行）。
 */
export const CLAUDE_DEFAULT_MODEL_ALIAS = 'default'

/**
 * 规范化 Claude 会话模型（mobi 模型选择 → CC 模型值的**唯一翻译点**）。
 * - 空值 / 未指定 → null（不传 model，由 CC 启动默认兜底）
 * - mobi 哨兵 `auto` → CC 别名 `default`（含首尾空白归一）
 * - 其余原样（去首尾空白）
 */
export function normalizeClaudeSessionModel(model: string | undefined): SessionModel {
    if (!model || !model.trim()) {
        return null
    }
    const trimmed = model.trim()
    return trimmed === DEFAULT_MODEL ? CLAUDE_DEFAULT_MODEL_ALIAS : trimmed
}
