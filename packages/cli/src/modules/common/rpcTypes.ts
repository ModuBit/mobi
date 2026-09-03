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

import type { EffortLevel, PermissionMode } from '@mobi/shared'

export interface SpawnSessionOptions {
    machineId?: string
    directory: string
    sessionId?: string
    resumeSessionId?: string
    approvedNewDirectoryCreation?: boolean
    agent?: 'claude'  // Mobi 当前仅支持 Claude
    model?: string
    effort?: EffortLevel  // reasoning effort (low | medium | high | xhigh)
    outputStyle?: string  // CC output style（Default/Proactive/Concise/Explanatory/Learning 或自定义名）
    permissionMode?: PermissionMode
    token?: string
    sessionType?: 'simple' | 'worktree'
    worktreeName?: string
    /** 归属项目 id（Web spawn 透传；缺省 = 游离） */
    projectId?: string
}

export type SpawnSessionResult =
    | { type: 'success'; sessionId: string }
    | { type: 'requestToApproveDirectoryCreation'; directory: string }
    | { type: 'error'; errorMessage: string }
