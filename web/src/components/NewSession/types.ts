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
 * Mobi 当前仅支持 Claude Code
 */
export type AgentType = 'claude'

/**
 * 会话类型
 */
export type SessionType = 'simple' | 'worktree'

/**
 * Claude 模型选项
 */
export const CLAUDE_MODEL_OPTIONS: { value: string; label: string }[] = [
    { value: 'auto', label: '自动' },
    { value: 'opus', label: 'Opus' },
    { value: 'opus[1m]', label: 'Opus 1M' },
    { value: 'sonnet', label: 'Sonnet' },
    { value: 'sonnet[1m]', label: 'Sonnet 1M' },
]

/**
 * 各 Agent 支持的模型选项
 */
export const MODEL_OPTIONS: Record<AgentType, { value: string; label: string }[]> = {
    claude: CLAUDE_MODEL_OPTIONS,
}
