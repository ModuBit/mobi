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

/**
 * Web 前端 API 类型定义（唯一类型源）
 * 所有 API 相关类型统一在此文件定义，禁止在其他位置重复定义
 */

import type {
    AgentState,
    AttachmentMetadata,
    DecryptedMessage as ProtocolDecryptedMessage,
    Session,
    SessionSummary,
    SyncEvent,
    WorktreeMetadata,
} from '@mobi/shared'

// ============ 从 @mobi/shared 重新导出 ============

export type {
    AgentState,
    AttachmentMetadata,
    Session,
    SessionSummary,
    SyncEvent,
    WorktreeMetadata,
}

// ============ 消息类型 ============

// 消息发送状态
export type MessageStatus = 'sending' | 'sent' | 'failed'

// 扩展的解密消息（包含发送状态）
export type DecryptedMessage = ProtocolDecryptedMessage & {
    status?: MessageStatus
    originalText?: string
}

// ============ 会话类型 ============

// 会话元数据摘要
export type SessionMetadataSummary = {
    path: string
    host: string
    version?: string
    name?: string
    os?: string
    summary?: { text: string; updatedAt: number }
    machineId?: string
    tools?: string[]
    flavor?: string | null
    worktree?: WorktreeMetadata
}

// 会话列表响应
export type SessionsResponse = { sessions: SessionSummary[] }
export type SessionResponse = { session: Session }

// 消息分页响应
export type MessagesResponse = {
    messages: DecryptedMessage[]
    page: {
        limit: number
        beforeSeq: number | null
        nextBeforeSeq: number | null
        hasMore: boolean
    }
}

// ============ 机器类型 ============

// Runner 状态
export type RunnerState = {
    status?: string
    pid?: number
    httpPort?: number
    startedAt?: number
    shutdownRequestedAt?: number
    shutdownSource?: string
    lastSpawnError?: {
        message: string
        pid?: number
        exitCode?: number | null
        signal?: string | null
        at: number
    } | null
}

// 机器信息
export type Machine = {
    id: string
    active: boolean
    metadata: {
        host: string
        platform: string
        displayName?: string
        homeDir?: string
    } | null
    runnerState?: RunnerState | null
}

export type MachinesResponse = { machines: Machine[] }
export type MachinePathsExistsResponse = { exists: Record<string, boolean> }

// ============ 认证类型 ============

export type AuthResponse = {
    token: string
    user: {
        id: number
        username?: string
        firstName?: string
        lastName?: string
    }
}

export type ApiConfig = {
    baseUrl: string
    token: string | null
}

// ============ 启动/操作类型 ============

export type SpawnResponse =
    | { type: 'success'; sessionId: string }
    | { type: 'error'; message: string }

// ============ Git 类型 ============

export type GitStatusResponse = {
    files: GitStatusFile[]
    branch: string
    ahead: number
    behind: number
}

export type GitStatusFile = {
    path: string
    status: string
    staged: boolean
}

export type GitDiffResponse = {
    diff: string
}

export type GitCommandResponse = {
    success: boolean
    stdout?: string
    stderr?: string
    exitCode?: number
    error?: string
}

export type GitFileStatus = {
    fileName: string
    filePath: string
    fullPath: string
    status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflicted'
    isStaged: boolean
    linesAdded: number
    linesRemoved: number
    oldPath?: string
}

export type GitStatusFiles = {
    stagedFiles: GitFileStatus[]
    unstagedFiles: GitFileStatus[]
    branch: string | null
    totalStaged: number
    totalUnstaged: number
}

// ============ 文件类型 ============

export type FileSearchItem = {
    fileName: string
    filePath: string
    fullPath: string
    fileType: 'file' | 'folder'
}

export type FileSearchResponse = {
    success: boolean
    files?: FileSearchItem[]
    error?: string
}

export type DirectoryEntry = {
    name: string
    type: 'file' | 'directory' | 'other'
    size?: number
    modified?: number
}

export type ListDirectoryResponse = {
    success: boolean
    entries?: DirectoryEntry[]
    error?: string
}

export type FileReadResponse = {
    success: boolean
    content?: string
    error?: string
}

export type UploadFileResponse = {
    success: boolean
    path?: string
    error?: string
}

export type DeleteUploadResponse = {
    success: boolean
    error?: string
}

// ============ 会话分组类型 ============

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

// ============ 斜杠命令 & 技能 ============

export type SlashCommand = {
    name: string
    description?: string
    source: 'builtin' | 'user' | 'plugin' | 'project'
    content?: string
    pluginName?: string
}

export type SlashCommandsResponse = {
    success: boolean
    commands?: SlashCommand[]
    error?: string
}

export type SkillSummary = {
    name: string
    description?: string
    source?: 'builtin' | 'user' | 'plugin' | 'project'
}

/** 文件树节点 */
export type FileNode = {
    name: string
    path: string
    type: 'file' | 'directory'
}

export type SkillsResponse = {
    success: boolean
    skills?: SkillSummary[]
    error?: string
}
