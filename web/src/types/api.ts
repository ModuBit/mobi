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

import type {
    AgentState,
    AttachmentMetadata,
    DecryptedMessage as ProtocolDecryptedMessage,
    Session,
    SessionSummary,
    WorktreeMetadata
} from '@mobi/shared'

// 从 @mobi/shared 重新导出类型
export type {
    AgentState,
    AttachmentMetadata,
    Session,
    SessionSummary,
    WorktreeMetadata
} from '@mobi/shared'

// 消息发送状态
export type MessageStatus = 'sending' | 'sent' | 'failed'

// 扩展的解密消息（包含发送状态）
export type DecryptedMessage = ProtocolDecryptedMessage & {
    status?: MessageStatus
    originalText?: string
}

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
    } | null
    runnerState?: RunnerState | null
}

// 认证响应
export type AuthResponse = {
    token: string
    user: {
        id: number
        username?: string
        firstName?: string
        lastName?: string
    }
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

// 机器列表响应
export type MachinesResponse = { machines: Machine[] }
export type MachinePathsExistsResponse = { exists: Record<string, boolean> }

// 启动响应
export type SpawnResponse =
    | { type: 'success'; sessionId: string }
    | { type: 'error'; message: string }

// Git 命令响应
export type GitCommandResponse = {
    success: boolean
    stdout?: string
    stderr?: string
    exitCode?: number
    error?: string
}

// 文件搜索项
export type FileSearchItem = {
    fileName: string
    filePath: string
    fullPath: string
    fileType: 'file' | 'folder'
}

// 文件搜索响应
export type FileSearchResponse = {
    success: boolean
    files?: FileSearchItem[]
    error?: string
}

// 目录条目
export type DirectoryEntry = {
    name: string
    type: 'file' | 'directory' | 'other'
    size?: number
    modified?: number
}

// 列出目录响应
export type ListDirectoryResponse = {
    success: boolean
    entries?: DirectoryEntry[]
    error?: string
}

// 读取文件响应
export type FileReadResponse = {
    success: boolean
    content?: string
    error?: string
}

// 上传文件响应
export type UploadFileResponse = {
    success: boolean
    path?: string
    error?: string
}

// 删除上传响应
export type DeleteUploadResponse = {
    success: boolean
    error?: string
}

// Git 文件状态
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

// Git 状态文件
export type GitStatusFiles = {
    stagedFiles: GitFileStatus[]
    unstagedFiles: GitFileStatus[]
    branch: string | null
    totalStaged: number
    totalUnstaged: number
}

// 斜杠命令
export type SlashCommand = {
    name: string
    description?: string
    source: 'builtin' | 'user' | 'plugin' | 'project'
    content?: string
    pluginName?: string
}

// 斜杠命令响应
export type SlashCommandsResponse = {
    success: boolean
    commands?: SlashCommand[]
    error?: string
}

// 技能摘要
export type SkillSummary = {
    name: string
    description?: string
}

// 技能响应
export type SkillsResponse = {
    success: boolean
    skills?: SkillSummary[]
    error?: string
}
