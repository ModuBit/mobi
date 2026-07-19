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
 * Agent 类型定义
 */
export type AgentType = 'claude' | 'codex'

/**
 * Agent 选项元数据
 */
export interface AgentOption {
    value: AgentType
    label: string
    /** 是否可选；为 false 时该项灰显且不可点（如尚未就绪） */
    disabled?: boolean
    /** disabled 时悬浮提示的 i18n key */
    disabledTooltipKey?: string
}

/**
 * 新建会话可选 Agent 列表
 *
 * 新增 Agent 时在此登记；codex 等就绪后将 `disabled` 改为 false 即自动出现在选择器中。
 * 选择器仅当存在多个可选 Agent 时才展示，仅一个可选时默认选中并隐藏。
 */
export const AGENT_OPTIONS: AgentOption[] = [
    { value: 'claude', label: 'Claude Code' },
    { value: 'codex', label: 'Codex', disabled: true, disabledTooltipKey: 'newSession.codexComingSoon' },
]

/**
 * 会话类型
 */
export type SessionType = 'simple' | 'worktree'

/**
 * Claude 模型 fallback 选项（metadata 不可用时使用）
 */
export const CLAUDE_MODEL_FALLBACK: { value: string; displayName: string; description?: string }[] = [
    { value: 'auto', displayName: 'Auto', description: 'Use the default model' },
    { value: 'opus', displayName: 'Opus', description: 'Most capable for complex work' },
    { value: 'sonnet', displayName: 'Sonnet', description: 'Best for everyday tasks' },
    { value: 'haiku', displayName: 'Haiku', description: 'Fastest for quick answers' },
]
