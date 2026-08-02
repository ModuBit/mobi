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
import { usePromptSuggestionStore } from '@/core/data/stores/promptSuggestionStore'

/**
 * 会话删除时清理其前端残留状态：检视面板状态 + 所有缓存终端（xterm/socket）+ 瞬时建议。
 * 顺序关键：先从 store 读出 terminal tabs 逐个清缓存（dispose 发 terminal:close 杀 PTY），
 * 再 clearSession 清 store 元数据。clearSession 后拿不到 terminalId。
 */
export function clearSessionResources(sessionId: string): void {
    const tabs = useWorkspaceStore.getState().getSession(sessionId).tabs
    for (const tab of tabs) {
        if (tab.mode === 'terminal' && tab.terminalId) {
            clearCachedInstance(`terminal:${sessionId}:${tab.terminalId}`)
        }
    }
    useWorkspaceStore.getState().clearSession(sessionId)
    // 清理该 session 的瞬时下一轮建议
    usePromptSuggestionStore.getState().clearSession(sessionId)
}

/**
 * 登出/换号时清空全部会话相关前端状态：检视面板状态 + 所有缓存终端 + 全部瞬时建议。
 * SPA 内 logout→login 不刷新页面，必须显式清理避免上一用户残留。
 */
export function clearAllSessionResources(): void {
    useWorkspaceStore.getState().clearAll()
    clearAllInstances()
    usePromptSuggestionStore.getState().clearAll()
}
