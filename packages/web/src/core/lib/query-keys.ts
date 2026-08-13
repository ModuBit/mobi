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
 * React Query 查询键定义
 * 用于缓存键的一致性管理
 */
export const queryKeys = {
    /** 所有会话列表 */
    sessions: ['sessions'] as const,
    /** 单个会话 */
    session: (sessionId: string) => ['session', sessionId] as const,
    /** Sidechain 消息 */
    sidechainMessages: (sessionId: string, parentToolUseId: string) => ['sidechain-messages', sessionId, parentToolUseId] as const,
    /** 项目列表（第二维为 machineId 或 'all'；亦可作前缀失效所有项目查询） */
    projects: ['projects'] as const,
    /** 项目内会话（ID 分页；前缀 ['projectSessions'] 用于批量失效） */
    projectSessions: (projectId: string) => ['projectSessions', projectId] as const,
    /** 未归入项目的「最近」会话 */
    recentSessions: ['recentSessions'] as const,
    /** 机器列表 */
    machines: ['machines'] as const,
    /** 机器 SDK 元数据 */
    machineMetadata: (machineId: string, cwd: string) => ['machineMetadata', machineId, cwd] as const,
    /** Git 状态 */
    gitStatus: (sessionId: string) => ['git-status', sessionId] as const,
    /** Git 差异 */
    gitDiff: (sessionId: string, filePath?: string) => ['git-diff', sessionId, filePath] as const,
    /** 会话文件搜索 */
    sessionFiles: (sessionId: string, query: string) => ['session-files', sessionId, query] as const,
    /** 会话目录 */
    sessionDirectory: (sessionId: string, path: string) => ['session-directory', sessionId, path] as const,
    /** 某 session 下所有目录（用作 invalidate 前缀：打开文件树时刷新根 + 已展开子目录） */
    sessionDirectories: (sessionId: string) => ['session-directory', sessionId] as const,
    /** 会话文件（含 etag 维度：meta refetch 拿到新 etag → queryKey 变 → content 自动 refetch） */
    sessionFile: (sessionId: string, path: string, etag?: string) => ['session-file', sessionId, path, etag] as const,
    /** 会话文件元数据（mime/size/etag） */
    sessionFileMeta: (sessionId: string, path: string) => ['session-file-meta', sessionId, path] as const,
    /** Git 文件差异 */
    gitFileDiff: (sessionId: string, path: string, staged?: boolean) => [
        'git-file-diff',
        sessionId,
        path,
        staged ? 'staged' : 'unstaged'
    ] as const,
    /** SDK 元数据（commands, models, agents 等） */
    sdkMetadata: (sessionId: string) => ['sdkMetadata', sessionId] as const,
}
