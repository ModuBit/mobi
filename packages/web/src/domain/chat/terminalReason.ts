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
 * cancelled 终态的 terminal_reason 前端解释（spec §7.6）。
 *
 * 上游 terminal_reason 为开放 string 集合（CLI 原样透传），web 只解释已知 key：
 * 命中已知集合出 footer 标注文案 key，未知 key / 缺省不出（宁缺毋滥，不直出原始英文串）。
 */

/** 已知 terminal_reason → i18n 文案 key 映射 */
const TERMINAL_REASON_LABEL_KEYS: Readonly<Record<string, string>> = {
    api_error: 'chat.terminalReason.api_error',
    budget_exhausted: 'chat.terminalReason.budget_exhausted',
}

/** terminal_reason → footer 标注文案 key；未知 key / 缺省返回 null（不出标注） */
export function terminalReasonLabelKey(reason: string | null | undefined): string | null {
    if (!reason) return null
    return TERMINAL_REASON_LABEL_KEYS[reason] ?? null
}
