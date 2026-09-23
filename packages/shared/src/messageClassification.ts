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
 * 消息投影模块（单一来源）
 *
 * 回答两个正交问题，规则都集中在这一个文件：
 * 1. 写路径分类（classifyMessage）：discard / ephemeral / persistent——落库、推送、回放的管道处置。
 *    黑名单模式：只有明确匹配到 discard 或 ephemeral 规则的消息才会被特殊处理，
 *    其余一律默认 persistent。这样 Claude SDK 新增消息类型时不会误伤。
 * 2. 读路径可见性（isClaudeChatVisibleMessage）：web 聊天流渲染与否。
 *
 * 两个维度**不可互相派生**（不要试图用一个公式合并）：
 * - `system:init` 是 persistent 但不可见——system 家族在 UI 的呈现走白名单，与管道分类无关；
 * - `system:status` 是 ephemeral 但不可见——实时流里它由 CLI 信号通道消费，正文不进聊天流；
 * - `task_*` 家族是 ephemeral 且可见——「实时可见、历史回放过滤」就是 ephemeral 的语义。
 */

/** 消息分类 */
export type MessageCategory = 'discard' | 'ephemeral' | 'persistent'

interface ClassificationRule {
    type: string
    subtype?: string
}

/** 黑名单：CLI 直接丢弃 */
const DISCARD_RULES: readonly ClassificationRule[] = [
    // 以下均为 SDK 遥测/回执帧：非对话内容、无 UI 呈现价值，落库纯膨胀，连接 DB 都不进。
    // （对比 EPHEMERAL_RULES：那些至少实时推送时对用户有价值。）
    { type: 'system', subtype: 'thinking_tokens' }, // thinking token 计数遥测
    { type: 'system', subtype: 'hook_started' }, // hook 执行过程回执（started/progress/response 三段），调试 CLI 时看日志
    { type: 'system', subtype: 'hook_progress' },
    { type: 'system', subtype: 'hook_response' },
    { type: 'system', subtype: 'plugin_install' }, // 插件安装回执
    { type: 'system', subtype: 'files_persisted' }, // 文件持久化回执
    { type: 'auth_status' }, // 认证状态帧
    { type: 'rate_limit_event' }, // 限流事件帧
    // SDK 0.3.206 新增：排队消息生命周期回执（queued/started/completed/cancelled/discarded），
    // 控制帧非对话内容，每条用户消息产生 2-3 帧，落库纯膨胀。未来做排队终态特性走 onCommandLifecycle 回调
    { type: 'command_lifecycle' },
]

/**
 * 黑名单：存 DB 但查询历史时过滤（= 实时推送可见、历史回放不可见，ticket 定义的名字是 live-only）。
 *
 * 共同判据：这些帧在**实时流**里对用户有价值（进度反馈、建议），但**历史回放**时要么
 * 已被终态承载（工具卡/后台任务面板），要么回放一堆过程帧只会刷屏。
 */
const EPHEMERAL_RULES: readonly ClassificationRule[] = [
    // 后台任务过程帧：实时渲染进度；回放不需要——后台任务 UI 的权威数据源是
    // runtimeState.backgroundTasks（hub 从原始流派生），与时间线块无关（见 reducerTimeline）
    { type: 'system', subtype: 'task_progress' },
    { type: 'system', subtype: 'task_started' },
    { type: 'system', subtype: 'task_updated' },
    { type: 'system', subtype: 'task_notification' },
    // 工具过程帧：实时进度提示；回放时工具卡自身已承载终态
    { type: 'tool_progress' },
    { type: 'tool_use_summary' },
    // prompt 建议：只对「正在输入」的用户有意义，回放无意义
    { type: 'prompt_suggestion' },
    // CLI 状态帧：claudeRemote 只消费它的信号做幂等收口，正文不透传
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

// ============================================================================
// 读路径：web 聊天流可见性
// ============================================================================

/** system 家族在聊天流可见的子类型（白名单，独立于写路径 category，见模块头注释） */
const VISIBLE_CLAUDE_SYSTEM_SUBTYPES = new Set([
    'api_error',
    'api_retry',
    'turn_duration',
    'microcompact_boundary',
    'compact_boundary',
    'task_progress',
    'task_notification',
    'task_started',
    'task_updated',
])

/** 顶层不可见的控制帧（非对话内容，聊天中不渲染） */
const INVISIBLE_CLAUDE_TOP_LEVEL_TYPES = new Set([
    // SDK 0.3.206 的排队生命周期回执，早期版本曾被当 persistent 落库；
    // 新消息已由 classifyMessage discard 拦截，此处兜底静默过滤历史 DB 行（web 端不再 console.warn）
    'command_lifecycle',
])

/**
 * 判断 Claude 系统消息子类型是否在聊天中可见
 */
export function isClaudeChatVisibleSystemSubtype(subtype: unknown): subtype is string {
    return typeof subtype === 'string' && VISIBLE_CLAUDE_SYSTEM_SUBTYPES.has(subtype)
}

/**
 * 判断消息是否在 Claude 聊天流（实时）中可见
 *
 * - 非 system 顶层 type 一律视为可见（由 normalize handler 决定如何渲染，未识别类型在
 *   normalizeAgentRecord console.warn 后跳过，不走 JSON dump）。
 * - system 家族走白名单（VISIBLE_CLAUDE_SYSTEM_SUBTYPES），与写路径 category 无关。
 * 历史上曾为 tool_progress/tool_use_summary 设过顶层黑名单，接入 handler 后已移除——
 * 回滚入口是 git history，无需常驻空集合。
 */
export function isClaudeChatVisibleMessage(message: { type: unknown; subtype?: unknown }): boolean {
    if (message.type !== 'system') {
        return typeof message.type === 'string' && !INVISIBLE_CLAUDE_TOP_LEVEL_TYPES.has(message.type)
    }

    return isClaudeChatVisibleSystemSubtype(message.subtype)
}

