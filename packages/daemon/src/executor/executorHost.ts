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
 * WITHOUT WARRANTIES OR CONDITIONS, ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * 机器执行层内部接口（ticket-15，绞杀者起点）。
 *
 * daemon 侧一切「要在本机做的执行层事」（spawn / 文件 / git 审查 / webTools /
 * 元数据）都收到这个接口上，调用方（syncEngine 透传 + agent 会话服务）不再感知传输。
 * 唯一实现 {@link LocalMachineHost}（ticket-20 起 socket 版实现随 machine 通道删除）。
 *
 * `machineId` 参数保留（D4=C 路由残留）：多机删除是 ⑤ 的事，先不做形参收窄。
 * 返回类型沿用现有 RPC 结果类型——`RpcFailure` 的 `kind` 分类由实现保证
 * （agentSessionService 依此选文案，不读句子）。
 */

import type { DiffTarget, RedactedWebToolsConfig, ReviewActionResult, ReviewCommitsResult, ReviewContentsResult, ReviewFilesResult, ReviewOverview, ReviewPatchResult } from '@mobi/shared'
import type { EffortLevel, PermissionMode, SDKMetadata } from '@mobi/shared/types'
import type { RpcFailureKind } from '../sync/rpcFailure'

// 文件元数据（流式读取前置查询）与文件范围读取——响应形状单源在 shared，此处 re-export 兼容既有引用
import type {
    RpcFileMeta,
    ReadFileMetaResponse as RpcReadFileMetaResponse,
    RpcReadFileRangeResponse
} from '@mobi/shared/fileMeta'
export type { RpcFileMeta, RpcReadFileMetaResponse, RpcReadFileRangeResponse }

/** spawn 会话选项（深化候选②：位置参数 → 对象——effort/outputStyle 等字段此前靠
 *  第 9/10 位次约定透传，新增字段漏位/错位无法被类型捕获）。
 *  仅进程内签名；'spawn-mobi-session' 的 wire payload 本就是对象，线上协议不变 */
export type SpawnSessionOptions = {
    /** Mobi 当前仅支持 Claude */
    agent?: 'claude'
    model?: string
    permissionMode?: PermissionMode
    sessionType?: 'simple' | 'worktree'
    worktreeName?: string
    resumeSessionId?: string
    effort?: EffortLevel
    outputStyle?: string
    workspaceId?: string
}

export type SpawnGatewayResult =
    | { type: 'success'; sessionId: string }
    | { type: 'already-running' }
    | { type: 'error'; message: string; failure: RpcFailureKind }

/** 新会话 spawn 路径（agent 会话通道 / web 新建路由）无 resume 目标，already-running
 *  不可达——两处防御收窄共用此谓词与文案，防止字面量漂移（.scratch/wake-dedup） */
export const UNEXPECTED_ALREADY_RUNNING = 'Unexpected already-running for non-resume spawn'

export function isUnexpectedAlreadyRunning(
    result: SpawnGatewayResult,
): result is Extract<SpawnGatewayResult, { type: 'already-running' }> {
    return result.type === 'already-running'
}

export type RpcRefreshMetadataResponse = {
    success: boolean
    metadata?: SDKMetadata
    error?: string
}

// saveFile 响应（覆盖已存在文件 + etag OCC；请求侧 content 为 Uint8Array 二进制附件）
export type RpcSaveFileResponse =
    | { success: true; etag: string }
    | { success: false; conflict: true; currentEtag: string }
    | { success: false; error: string; code?: string }

// 文件范围写入响应（对称 readFileRange，content 为 Uint8Array 二进制附件）
export type RpcWriteFileRangeResponse = {
    success: boolean
    path?: string
    written?: number
    error?: string
}

export type RpcDeleteUploadResponse = {
    success: boolean
    error?: string
}

// 同 path 原子替换上传响应（「编辑已有上传」场景；content 为 Uint8Array 二进制附件）
export type RpcReplaceUploadResponse = {
    success: boolean
    error?: string
}

// web 工具配置读取响应（runner 侧凭据已脱敏）
export type RpcGetWebToolsConfigResponse = {
    config: RedactedWebToolsConfig
}

// web 工具配置写入响应（业务失败走 envelope，不用传输层错误表达）
export type RpcSetWebToolsConfigResponse =
    | { success: true }
    | { success: false; error: string }

// web 工具 provider 验证连接响应（一次轻量真实搜索；业务失败走 envelope）
export type RpcVerifyWebToolsProviderResponse =
    | { success: true; latencyMs: number }
    | { success: false; error: string }

export type RpcDirectoryEntry = {
    name: string
    type: 'file' | 'directory' | 'other'
    size?: number
    modified?: number
}

export type RpcListDirectoryResponse = {
    success: boolean
    entries?: RpcDirectoryEntry[]
    /** 树浏览：条目数达到上限被截断（搜索路径不置位） */
    truncated?: boolean
    /** 树浏览：截断前的条目总数，用于前端「共 N 项」提示 */
    total?: number
    error?: string
}

export type RpcPathExistsResponse = {
    exists: Record<string, boolean>
}

/**
 * 机器执行层接口。方法集与原 rpcGateway 的 machine 族方法一一对应
 * （grep `machineRpc(` 全集见 ticket-15 Comments），签名原样保留。
 */
export interface MachineHost {
    spawnSession(machineId: string, directory: string, options?: SpawnSessionOptions): Promise<SpawnGatewayResult>
    checkPathsExist(machineId: string, paths: string[]): Promise<Record<string, boolean>>
    machineReadFileMeta(machineId: string, cwd: string, path: string): Promise<RpcReadFileMetaResponse>
    machineReadFileRange(machineId: string, cwd: string, path: string, offset: number, length: number): Promise<RpcReadFileRangeResponse>
    machineGitReviewOverview(machineId: string, cwd: string, sessionId: string): Promise<ReviewOverview | { success: false; error: string }>
    machineGitReviewFiles(machineId: string, cwd: string, sessionId: string, target: DiffTarget): Promise<ReviewFilesResult | { success: false; error: string }>
    machineGitReviewDiff(machineId: string, cwd: string, sessionId: string, target: DiffTarget, path: string): Promise<ReviewPatchResult | { success: false; error: string }>
    machineGitReviewContents(machineId: string, cwd: string, sessionId: string, target: DiffTarget, path: string): Promise<ReviewContentsResult | { success: false; error: string }>
    machineGitReviewCommits(machineId: string, cwd: string, cursor?: string): Promise<ReviewCommitsResult | { success: false; error: string }>
    machineGitReviewInit(machineId: string, cwd: string): Promise<ReviewActionResult | { success: false; error: string }>
    clearTurnSnapshots(machineId: string, cwd: string, sessionId: string): Promise<void>
    machineSaveFile(machineId: string, cwd: string, path: string, content: Uint8Array, baseEtag: string): Promise<RpcSaveFileResponse>
    listMachineDirectory(machineId: string, path: string, homeDir: string): Promise<RpcListDirectoryResponse>
    machineUploadFileRange(machineId: string, cwd: string, filename: string, path: string | undefined, offset: number, content: Uint8Array, totalSize?: number): Promise<RpcWriteFileRangeResponse>
    machineDeleteUpload(machineId: string, cwd: string, path: string): Promise<RpcDeleteUploadResponse>
    machineReplaceUpload(machineId: string, cwd: string, path: string, content: Uint8Array): Promise<RpcReplaceUploadResponse>
    getWebToolsConfig(machineId: string): Promise<RpcGetWebToolsConfigResponse>
    setWebToolsConfig(machineId: string, config: unknown): Promise<RpcSetWebToolsConfigResponse>
    verifyWebToolsProvider(machineId: string, providerId: string, credentials?: Record<string, string>): Promise<RpcVerifyWebToolsProviderResponse>
    machineSearchFiles(machineId: string, cwd: string, query: string, type?: 'file' | 'directory'): Promise<RpcListDirectoryResponse>
    machineListSessionDirectory(machineId: string, cwd: string, path: string, prefix?: string): Promise<RpcListDirectoryResponse>
    machineRefreshMetadata(machineId: string, cwd: string): Promise<RpcRefreshMetadataResponse>
}
