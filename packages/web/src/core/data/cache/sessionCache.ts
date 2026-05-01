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

import type { Session } from '@/core/data/api/types'

/**
 * 将新 Session 数组与已有缓存合并
 * 已存在的 session 做增量合并（新字段覆盖旧字段），不存在的直接添加
 * 纯函数，便于测试
 */
export function mergeSessions(
    old: Session[] | undefined,
    incoming: Session[],
): Session[] {
    const sessionMap = new Map<string, Session>(old?.map(s => [s.id, s]))
    for (const s of incoming) {
        const existing = sessionMap.get(s.id)
        sessionMap.set(s.id, existing ? { ...existing, ...s } : s)
    }
    return Array.from(sessionMap.values())
}
