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

/** 驼峰 → 下划线 (parentUuid → parent_uuid) */
function camelToSnake(key: string): string {
    return key.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`)
}

/** 下划线 → 驼峰 (parent_uuid → parentUuid) */
function snakeToCamel(key: string): string {
    return key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
}

/**
 * 从对象中取值，兼容下划线和驼峰两种 key 格式。
 * 传入任一格式的 key，自动尝试另一种格式。
 *
 * @example
 * getField(data, 'parentUuid')   // 尝试 parentUuid → parent_uuid
 * getField(data, 'tool_use_result') // 尝试 tool_use_result → toolUseResult
 */
export function getField<T = unknown>(obj: Record<string, unknown>, key: string): T | undefined {
    if (key in obj) return obj[key] as T
    const alt = key.includes('_') ? snakeToCamel(key) : camelToSnake(key)
    if (alt in obj) return obj[alt] as T
    return undefined
}

export function isObject(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object'
}

export function asString(value: unknown): string | null {
    return typeof value === 'string' ? value : null
}

export function asNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function safeStringify(value: unknown): string {
    if (typeof value === 'string') return value
    try {
        const stringified = JSON.stringify(value, null, 2)
        return typeof stringified === 'string' ? stringified : String(value)
    } catch {
        return String(value)
    }
}
