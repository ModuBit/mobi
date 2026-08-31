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
 * 用户消息终态的前端解释（spec §7.6）：
 * - footer 终态标注（cancelled / discarded / refused——「这条没被处理/没被接收」一眼可见）
 * - terminal_reason 原因标注：上游为开放 string 集合（CLI 原样透传），web 只解释已知 key，
 *   命中已知集合出 footer 标注文案 key，未知 key / 缺省不出（宁缺毋滥，不直出原始英文串）。
 */

import type { MessageLifecycle } from '@mobi/shared'

/** footer 需出终态标注的 lifecycle 判据：cancelled / discarded / refused；其余（含 done）不标注 */
export function isTerminalUserLifecycle(lifecycle: MessageLifecycle | null | undefined): boolean {
    return lifecycle === 'cancelled' || lifecycle === 'discarded' || lifecycle === 'refused'
}

/** 终态 lifecycle → footer 标注文案 key；非终态返回 null（不出标注） */
export function terminalLifecycleLabelKey(lifecycle: MessageLifecycle | null | undefined): string | null {
    switch (lifecycle) {
        case 'cancelled': return 'chat.message.terminalCancelled'
        case 'discarded': return 'chat.message.terminalDiscarded'
        case 'refused': return 'chat.message.terminalRefused'
        default: return null
    }
}

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
