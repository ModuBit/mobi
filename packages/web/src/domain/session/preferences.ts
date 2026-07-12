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

import type { AgentType } from './types'
import { CLAUDE_MODEL_FALLBACK } from './types'
import { EFFORT_LEVELS, PERMISSION_MODES, type EffortLevel, type PermissionMode } from '@mobi/shared'

const AGENT_STORAGE_KEY = 'mobi:newSession:agent'
const MODEL_STORAGE_KEY = 'mobi:newSession:model'
const YOLO_STORAGE_KEY = 'mobi:newSession:yolo'
const EFFORT_STORAGE_KEY = 'mobi:newSession:effort'
const PERMISSION_MODE_STORAGE_KEY = 'mobi:newSession:permissionMode'

const VALID_MODELS = CLAUDE_MODEL_FALLBACK.map(m => m.value)

const VALID_AGENTS: AgentType[] = ['claude', 'codex']

function loadPreference<T extends string>(key: string, validate: (v: string) => v is T, fallback: T): T {
    try {
        const stored = localStorage.getItem(key)
        if (stored && validate(stored)) {
            return stored
        }
    } catch {
        // 忽略存储错误
    }
    return fallback
}

function savePreference(key: string, value: string): void {
    try {
        localStorage.setItem(key, value)
    } catch {
        // 忽略存储错误
    }
}

/**
 * 加载首选 Agent
 */
export function loadPreferredAgent(): AgentType {
    return loadPreference(AGENT_STORAGE_KEY, (v): v is AgentType => (VALID_AGENTS as readonly string[]).includes(v), 'claude')
}

/**
 * 保存首选 Agent
 */
export function savePreferredAgent(agent: AgentType): void {
    savePreference(AGENT_STORAGE_KEY, agent)
}

/**
 * 加载首选 Model
 */
export function loadPreferredModel(): string {
    return loadPreference(MODEL_STORAGE_KEY, (v): v is string => VALID_MODELS.includes(v), 'auto')
}

/**
 * 保存首选 Model
 */
export function savePreferredModel(model: string): void {
    savePreference(MODEL_STORAGE_KEY, model)
}

/**
 * 加载 YOLO 模式偏好
 */
export function loadPreferredYoloMode(): boolean {
    try {
        return localStorage.getItem(YOLO_STORAGE_KEY) === 'true'
    } catch {
        return false
    }
}

/**
 * 保存 YOLO 模式偏好
 */
export function savePreferredYoloMode(enabled: boolean): void {
    savePreference(YOLO_STORAGE_KEY, enabled ? 'true' : 'false')
}

/**
 * 加载首选 Effort
 */
export function loadPreferredEffort(): EffortLevel {
    return loadPreference(EFFORT_STORAGE_KEY, (v): v is EffortLevel => EFFORT_LEVELS.includes(v as EffortLevel), 'medium')
}

/**
 * 保存首选 Effort
 */
export function savePreferredEffort(effort: EffortLevel): void {
    savePreference(EFFORT_STORAGE_KEY, effort)
}

/**
 * 加载首选权限模式
 *
 * 默认 auto：日常最常用、最适合远程托管场景（安全且少打扰）。
 * 注意：仅对"无已存偏好"的用户生效；localStorage 已记录的偏好不被覆盖。
 *
 * 已知限制：auto 受账号 Plan / 模型版本 / Provider 影响（Bedrock / Vertex /
 * Foundry 需设 CLAUDE_CODE_ENABLE_AUTO_MODE=1）。多数 Anthropic 官方 API 用户
 * 支持；若运行时 SDK 拒绝 auto，会话创建会失败——用户需手动切换其他模式。
 */
export function loadPreferredPermissionMode(): PermissionMode {
    return loadPreference(
        PERMISSION_MODE_STORAGE_KEY,
        (v): v is PermissionMode => (PERMISSION_MODES as readonly string[]).includes(v),
        'auto'
    )
}

/**
 * 保存首选权限模式
 */
export function savePreferredPermissionMode(mode: PermissionMode): void {
    savePreference(PERMISSION_MODE_STORAGE_KEY, mode)
}
