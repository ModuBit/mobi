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

import type { Session } from '../sync/syncEngine'

export type NotificationChannel = {
    sendReady: (session: Session) => Promise<void>
    /**
     * @param requestId 触发本次通知的那笔审批请求 id（批量到达时为窗口内第一笔）。
     *   前端通知卡片据此就地渲染审批 UI；请求本体仍从 session.agentState.requests 读取。
     */
    sendPermissionRequest: (session: Session, requestId?: string | null) => Promise<void>
}

export type NotificationHubOptions = {
    readyCooldownMs?: number
    permissionDebounceMs?: number
}
