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

import type { AgentStatus } from '@/components/pixel-avatar/types'
import type { Session } from '@/core/data/api/types'
import { basename } from '@/core/utils/path'

/**
 * 根据会话状态映射为头像状态
 * 多处复用：SidebarProjects、SessionList、MobileProjectList
 */
export function getSessionAvatarStatus(session: Session): AgentStatus {
    if (!session.active) return 'inactive'
    const pendingRequests = session.agentState?.requests
    if (pendingRequests && Object.keys(pendingRequests).length > 0) return 'awaiting_auth'
    if (session.running) return 'outputting'
    return 'idle'
}

/**
 * 从 group.key 路径提取最后一段目录名（用于展示）
 * 复用 path.basename（处理反斜杠与空段，更健壮）
 */
export function extractFolderName(key: string): string {
    return basename(key) || key
}
