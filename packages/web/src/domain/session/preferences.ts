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
