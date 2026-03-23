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

// 从 @mobi/shared 导入类型
import type { Session, DecryptedMessage, SyncEvent, Metadata } from '@mobi/shared'

export type { Session, DecryptedMessage, SyncEvent }

export interface ApiConfig {
    baseUrl: string
    token: string | null
}

export interface SessionsResponse {
    sessions: Session[]
}

export interface MessagesResponse {
    messages: DecryptedMessage[]
    hasMore: boolean
}

export interface GitStatusResponse {
    files: GitStatusFile[]
    branch: string
    ahead: number
    behind: number
}

export interface GitStatusFile {
    path: string
    status: string
    staged: boolean
}

export interface GitDiffResponse {
    diff: string
}

// ============ Session Group Types ============

export interface SessionGroup {
    key: string
    name: string
    activeCount: number
    totalCount: number
    updatedAt: number
}

export interface SessionGroupsResponse {
    groups: SessionGroup[]
}

export interface GroupSessionsResponse {
    sessions: Session[]
    nextCursor: number | null
    hasMore: boolean
}

// ============ Machine Types ============

export interface Machine {
    id: string
    active: boolean
    activeAt: number
    metadata: Metadata | null
}

export interface MachinesResponse {
    machines: Machine[]
}
