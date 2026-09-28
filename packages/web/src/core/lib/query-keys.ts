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
 * 工作区内会话查询的根前缀
 * 单独导出供批量失效所有 ['workspaceSessions', workspaceId] 查询使用（invalidateWorkspaceViews）
 */
const workspaceSessionsRoot = ['workspaceSessions'] as const

/**
 * React Query 查询键定义
 * 用于缓存键的一致性管理
 */
export const queryKeys = {
    /** 所有会话列表 */
    sessions: ['sessions'] as const,
    /** hub 活跃桌面观看流（侧边栏「远程桌面」分区数据源） */
    desktopStreams: ['desktop-streams'] as const,
    /** 单个会话 */
    session: (sessionId: string) => ['session', sessionId] as const,
    /** Sidechain 消息 */
    sidechainMessages: (sessionId: string, parentToolUseId: string) => ['sidechain-messages', sessionId, parentToolUseId] as const,
    /** 工作区列表（第二维为 machineId 或 'all'；亦可作前缀失效所有工作区查询） */
    workspaces: ['workspaces'] as const,
    /** 工作区内会话根前缀（批量失效所有工作区的会话分组查询） */
    workspaceSessionsRoot,
    /** 工作区内会话（ID 分页；前缀失效走 workspaceSessionsRoot） */
    workspaceSessions: (workspaceId: string) => [...workspaceSessionsRoot, workspaceId] as const,
    /** 未归入工作区的「最近」会话 */
    recentSessions: ['recentSessions'] as const,
    /** 置顶会话（跨工作区/游离，「置顶」区数据源） */
    pinnedSessions: ['pinnedSessions'] as const,
    /** 机器列表 */
    machines: ['machines'] as const,
    /** 机器 SDK 元数据 */
    machineMetadata: (machineId: string, cwd: string) => ['machineMetadata', machineId, cwd] as const,
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
    /** git 审查总览（四档范围数据） */
    gitReview: (sessionId: string) => ['git-review', sessionId] as const,
    /** git 审查单文件 diff（version = 审查总览的 updatedAt：总览刷新即旧 diff 失效；两树指针不进协议） */
    gitReviewFile: (sessionId: string, scope: string, path: string, version = '') => ['git-review-file', sessionId, scope, path, version] as const,
    /** SDK 元数据（commands, models, agents 等） */
    sdkMetadata: (sessionId: string) => ['sdkMetadata', sessionId] as const,
    /** Web 工具脱敏配置（子页与入口徽标共用同一缓存：状态由 select 派生，保存后失效即两处同步） */
    webToolsConfig: ['web-tools-config'] as const,
}
