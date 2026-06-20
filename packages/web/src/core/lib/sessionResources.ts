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

import { useWorkspaceStore } from '@/core/data/stores/workspaceStore'
import { clearCachedInstance, clearAllInstances } from '@/core/hooks/useCachedInstance'

/** 终端缓存 key 规则（与 TerminalView 保持一致） */
const terminalCacheKey = (sessionId: string) => `terminal:${sessionId}`

/**
 * 会话删除时清理其前端残留状态：检视面板状态 + 缓存终端（xterm/socket）。
 * 缓存终端被清理时其 dispose 会向后端发 terminal:close，关闭常驻 PTY。
 */
export function clearSessionResources(sessionId: string): void {
    useWorkspaceStore.getState().clearSession(sessionId)
    clearCachedInstance(terminalCacheKey(sessionId))
}

/**
 * 登出/换号时清空全部会话相关前端状态：检视面板状态 + 所有缓存终端。
 * SPA 内 logout→login 不刷新页面，必须显式清理避免上一用户残留。
 */
export function clearAllSessionResources(): void {
    useWorkspaceStore.getState().clearAll()
    clearAllInstances()
}
