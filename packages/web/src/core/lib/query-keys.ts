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
import type { DiffTarget } from '@mobi/shared'
import { serializeTargetKey } from '@/components/review/reviewEntries'

/** DiffTarget → 查询键片段（统一走 serializeTargetKey，与 viewState/菜单 key 同一 wire 契约） */
const targetKey = serializeTargetKey

const workspaceSessionsRoot = ['workspaceSessions'] as const

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
    /** 工作区列表（可作前缀失效所有工作区查询） */
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
    /** daemon 状态（单机：GET /api/daemon/status，取代机器列表作为宿主身份/就绪源） */
    daemonStatus: ['daemon-status'] as const,
    /** 机器 SDK 元数据（machine 通道过渡；203 后宿主元数据走 hostMetadata） */
    /** 宿主 SDK 元数据（单机：cwd 单维度，原 machineMetadata 去 machineId） */
    hostMetadata: (cwd: string) => ['hostMetadata', cwd] as const,
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
    // ── 审查 v2（DiffTarget 统一模型）：target 进键用 JSON 稳定序列化；
    //  version = 总览的 targetGeneration（CLI 数据版本，防「总览展示与点击之间数据变化」陈旧）──
    gitReviewOverview: (sessionId: string) => ['git-review-v2-overview', sessionId] as const,
    gitReviewFiles: (sessionId: string, target: DiffTarget, version: number | string = '') => ['git-review-v2-files', sessionId, targetKey(target), String(version)] as const,
    gitReviewPatch: (sessionId: string, target: DiffTarget, path: string, version: number | string = '') => ['git-review-v2-patch', sessionId, targetKey(target), path, String(version)] as const,
    gitReviewContents: (sessionId: string, target: DiffTarget, path: string, version: number | string = '') => ['git-review-v2-contents', sessionId, targetKey(target), path, String(version)] as const,
    gitReviewCommits: (sessionId: string) => ['git-review-v2-commits', sessionId] as const,
    /** 记忆设置（daemon settings.daemon.json memory 段脱敏回显） */
    memorySettings: ['memory-settings'] as const,
    /** SDK 元数据（commands, models, agents 等） */
    sdkMetadata: (sessionId: string) => ['sdkMetadata', sessionId] as const,
    /** Web 工具脱敏配置（子页与入口徽标共用同一缓存：状态由 select 派生，保存后失效即两处同步） */
    webToolsConfig: ['web-tools-config'] as const,
}
