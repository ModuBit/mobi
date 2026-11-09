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

import { isSettingsPath } from '@/domain/navigation/settingsPath'

const ORIGIN_KEY = 'settings.returnOrigin'

/**
 * 设置返回链路的来源记录（sessionStorage，per-tab）：
 * MainLayout 在每次落在非设置路由时刷新记录——进入设置后记录不再变化，
 * 返回键无应用内历史可回时（深链直进）落到这份来源，再兜底 /sessions/new（见 getSettingsReturnOrigin）。
 * 隐私模式等 storage 异常一律静默：来源只是体验优化，丢了的后果是兜底到新对话。
 */
export function setSettingsReturnOrigin(pathname: string): void {
    try {
        sessionStorage.setItem(ORIGIN_KEY, pathname)
    } catch {
        // 静默
    }
}

/** 读取来源记录；无记录或存储异常返回 null（调用方兜底 /sessions/new） */
export function getSettingsReturnOrigin(): string | null {
    try {
        return sessionStorage.getItem(ORIGIN_KEY)
    } catch {
        return null
    }
}

/** 返回链路裁决：有应用内历史优先 history.back（自然语义），否则落记录来源，最后兜底新对话 */
export function resolveSettingsBackTarget(canGoBack: boolean): { mode: 'history' } | { mode: 'navigate'; to: string } {
    if (canGoBack) return { mode: 'history' }
    return { mode: 'navigate', to: getSettingsReturnOrigin() ?? '/sessions/new' }
}

/** 判断 pathname 是否可作为返回来源（非设置路由族）——复用 isSettingsPath 单一判断 */
export function isSettingsReturnOriginCandidate(pathname: string): boolean {
    return !isSettingsPath(pathname)
}
