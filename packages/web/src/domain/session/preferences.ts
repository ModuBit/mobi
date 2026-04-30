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
import { EFFORT_LEVELS, type EffortLevel } from '@mobi/shared'

const AGENT_STORAGE_KEY = 'mobi:newSession:agent'
const YOLO_STORAGE_KEY = 'mobi:newSession:yolo'
const EFFORT_STORAGE_KEY = 'mobi:newSession:effort'

const VALID_AGENTS: AgentType[] = ['claude', 'codex']

/**
 * 加载首选 Agent
 */
export function loadPreferredAgent(): AgentType {
    try {
        const stored = localStorage.getItem(AGENT_STORAGE_KEY)
        if (stored && VALID_AGENTS.includes(stored as AgentType)) {
            return stored as AgentType
        }
    } catch {
        // 忽略存储错误
    }
    return 'claude'
}

/**
 * 保存首选 Agent
 */
export function savePreferredAgent(agent: AgentType): void {
    try {
        localStorage.setItem(AGENT_STORAGE_KEY, agent)
    } catch {
        // 忽略存储错误
    }
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
    try {
        localStorage.setItem(YOLO_STORAGE_KEY, enabled ? 'true' : 'false')
    } catch {
        // 忽略存储错误
    }
}

/**
 * 加载首选 Effort
 */
export function loadPreferredEffort(): EffortLevel {
    try {
        const stored = localStorage.getItem(EFFORT_STORAGE_KEY)
        if (stored && EFFORT_LEVELS.includes(stored as EffortLevel)) {
            return stored as EffortLevel
        }
    } catch { /* noop */ }
    return 'medium'
}

/**
 * 保存首选 Effort
 */
export function savePreferredEffort(effort: EffortLevel): void {
    try {
        localStorage.setItem(EFFORT_STORAGE_KEY, effort)
    } catch { /* noop */ }
}
