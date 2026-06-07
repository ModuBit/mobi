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
 * 消息分类规则
 *
 * 黑名单模式：只有明确匹配到 discard 或 ephemeral 规则的消息才会被特殊处理，
 * 其余一律默认 persistent。这样 Claude SDK 新增消息类型时不会误伤。
 */

/** 消息分类 */
export type MessageCategory = 'discard' | 'ephemeral' | 'persistent'

interface ClassificationRule {
    type: string
    subtype?: string
}

/** 黑名单：CLI 直接丢弃 */
const DISCARD_RULES: readonly ClassificationRule[] = [
    { type: 'system', subtype: 'thinking_tokens' },
    { type: 'system', subtype: 'hook_started' },
    { type: 'system', subtype: 'hook_progress' },
    { type: 'system', subtype: 'hook_response' },
    { type: 'system', subtype: 'plugin_install' },
    { type: 'system', subtype: 'files_persisted' },
    { type: 'auth_status' },
    { type: 'rate_limit_event' },
]

/** 黑名单：存 DB 但查询历史时过滤 */
const EPHEMERAL_RULES: readonly ClassificationRule[] = [
    { type: 'system', subtype: 'task_progress' },
    { type: 'system', subtype: 'task_started' },
    { type: 'system', subtype: 'task_updated' },
    { type: 'system', subtype: 'task_notification' },
    { type: 'tool_progress' },
    { type: 'tool_use_summary' },
    { type: 'prompt_suggestion' },
    { type: 'system', subtype: 'status' },
]

function matchesRule(rule: ClassificationRule, type: string, subtype?: string | null): boolean {
    if (rule.type !== type) return false
    if (rule.subtype !== undefined && rule.subtype !== subtype) return false
    return true
}

/**
 * 分类消息（黑名单模式，默认 persistent）
 *
 * @param type 消息类型（如 'system', 'assistant', 'tool_progress'）
 * @param subtype 消息子类型（如 'init', 'hook_started'），可选
 * @returns 消息分类
 */
export function classifyMessage(type: string, subtype?: string | null): MessageCategory {
    for (const rule of DISCARD_RULES) {
        if (matchesRule(rule, type, subtype)) return 'discard'
    }
    for (const rule of EPHEMERAL_RULES) {
        if (matchesRule(rule, type, subtype)) return 'ephemeral'
    }
    return 'persistent'
}

