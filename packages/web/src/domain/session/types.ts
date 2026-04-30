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
 * 会话类型
 */
export type SessionType = 'simple' | 'worktree'

/**
 * Claude 模型 fallback 选项（metadata 不可用时使用）
 */
export const CLAUDE_MODEL_FALLBACK: { value: string; displayName: string }[] = [
    { value: 'auto', displayName: 'Auto' },
    { value: 'opus', displayName: 'Opus' },
    { value: 'sonnet', displayName: 'Sonnet' },
    { value: 'haiku', displayName: 'Haiku' },
]
