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
 * 模型下拉选项单一来源（创建页与会话内共用）：
 * 宿主探针清单 → 选项；探针未就绪/失败时回落兜底四项；`auto` 恒为首位合成项。
 */

import { CLAUDE_MODEL_FALLBACK, type ModelInfo } from '@mobi/shared'

export interface ModelSelectOption {
    value: string
    /** 触发器/窄容器用的短名（剥掉 `Opus 4.6 (1M context)` 尾部括注） */
    label: string
    description?: string
}

const AUTO_MODEL_OPTION: ModelSelectOption = {
    value: 'auto',
    label: CLAUDE_MODEL_FALLBACK[0].displayName,
    description: CLAUDE_MODEL_FALLBACK[0].description,
}

/** 剥掉 displayName 尾部括注（如 `(1M context)`），窄容器里只留模型名 */
function toShortLabel(displayName: string): string {
    return displayName.replace(/\s*\([^()]*\)\s*$/, '')
}

/**
 * 由探针模型清单构建下拉选项。
 *
 * - 清单为空（探针未就绪 / 失败）：回落兜底四项
 * - 清单不含 `auto` 时把它合成到首位（探针清单未必列默认项）
 * - 保留探针给出的顺序，不重排（顺序承载“默认/推荐”语义）
 */
export function buildModelSelectOptions(models?: readonly ModelInfo[] | null): ModelSelectOption[] {
    if (!models || models.length === 0) {
        return CLAUDE_MODEL_FALLBACK.map(opt => ({
            value: opt.value,
            label: opt.displayName,
            description: opt.description,
        }))
    }
    const probed = models.map(m => ({
        value: m.value,
        label: toShortLabel(m.displayName),
        description: m.description,
    }))
    return probed.some(o => o.value === AUTO_MODEL_OPTION.value)
        ? probed
        : [AUTO_MODEL_OPTION, ...probed]
}

/**
 * 校正存过的首选 model（创建页偏好 → 实际选中的 model）。
 *
 * model-catalog 之前存的是 `opus` / `sonnet` 这类预设别名，宿主目录里没有对应 value：
 * 列表里选不到它，pill 只能把原值裸显出来（`opus`），用户既看不出也改不掉来源。
 * 目录到位后若查无此值就回 `auto`。
 *
 * 目录为空（探针未就绪 / 失败）时原样返回——此时清单不可信，把显式选择清成 auto
 * 会把「探针慢」误判成「模型不存在」。
 */
export function reconcileStoredModel(stored: string, models?: readonly ModelInfo[] | null): string {
    if (!models || models.length === 0) return stored
    if (models.some(m => m.value === stored)) return stored
    return AUTO_MODEL_OPTION.value
}
