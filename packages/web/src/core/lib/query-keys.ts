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
    /** 会话消息 */
    messages: (sessionId: string) => ['messages', sessionId] as const,
    /** Sidechain 消息 */
    sidechainMessages: (sessionId: string, parentToolUseId: string) => ['sidechain-messages', sessionId, parentToolUseId] as const,
    /** 会话分组列表 */
    sessionGroups: ['sessionGroups'] as const,
    /** 分组下的会话 */
    groupSessions: (groupKey: string) => ['groupSessions', groupKey] as const,
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
    /** 会话文件 */
    sessionFile: (sessionId: string, path: string) => ['session-file', sessionId, path] as const,
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
