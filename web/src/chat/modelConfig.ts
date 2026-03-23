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

import { isClaudeModelPreset } from '@mobi/shared'

/**
 * 上下文窗口大小因模型/提供商而异，可能随时间变化。
 *
 * UI 只需要这个来计算保守的"剩余上下文"警告。
 * 我们有意保留一个头部预算，以避免在限制附近出现虚假信心
 * （系统提示、工具开销和其他隐藏标记可能会消耗额外空间）。
 *
 * 如果/当服务器提供明确的每会话上下文限制时，优先使用该限制，
 * 此函数仅作为后备。
 */
const CONTEXT_HEADROOM_TOKENS = 10_000
const DEFAULT_CLAUDE_CONTEXT_WINDOW_TOKENS = 200_000
const LARGE_CLAUDE_CONTEXT_WINDOW_TOKENS = 1_000_000

export function getContextBudgetTokens(model: string | null | undefined, flavor?: string | null): number | null {
    if (flavor !== 'claude') {
        return null
    }

    const trimmedModel = model?.trim()
    const windowTokens = (() => {
        if (!trimmedModel) {
            return DEFAULT_CLAUDE_CONTEXT_WINDOW_TOKENS
        }
        if (isClaudeModelPreset(trimmedModel)) {
            return trimmedModel.endsWith('[1m]')
                ? LARGE_CLAUDE_CONTEXT_WINDOW_TOKENS
                : DEFAULT_CLAUDE_CONTEXT_WINDOW_TOKENS
        }
        if (trimmedModel.startsWith('claude-')) {
            return DEFAULT_CLAUDE_CONTEXT_WINDOW_TOKENS
        }
        return null
    })()

    if (!windowTokens) return null
    return Math.max(1, windowTokens - CONTEXT_HEADROOM_TOKENS)
}
