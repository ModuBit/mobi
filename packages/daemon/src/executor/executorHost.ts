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
 * 唯一实现 {@link LocalExecutor}（socket 版实现随 machine 通道删除，ticket-20）。
 *
 * 返回类型沿用现有 RPC 结果类型——`RpcFailure` 的 `kind` 分类由实现保证
 * （agentSessionService 依此选文案，不读句子）。
 */

import type { RedactedWebToolsConfig } from '@mobi/shared'
import type { EffortLevel, PermissionMode } from '@mobi/shared/types'
import type { RpcFailureKind } from '../sync/rpcFailure'
import type { RefreshMetadataResponse } from '@mobi/node-core/handlers/commands'

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
    /** mobi 会话行 id（唤醒/激活路径携带）：executor spawn 查重键之一，见 shared SpawnSessionOptions */
    sessionId?: string
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

// refreshMetadata 是唯一活 wire（daemon rpcGateway ↔ 会话进程 socket），envelope 原样保留；
// 形状单源在 node-core commands.RefreshMetadataResponse（深化候选②票②：别名化消 as）
export type RpcRefreshMetadataResponse = RefreshMetadataResponse

// saveFile 响应（覆盖已存在文件 + etag OCC；请求侧 content 为 Uint8Array 二进制附件）
export type RpcSaveFileResponse =
    | { success: true; etag: string }
    | { success: false; conflict: true; currentEtag: string }
    | { success: false; error: string; code?: string }

// 文件范围写入响应（对称 readFileRange，content 为 Uint8Array 二进制附件）。
// 精确 union（深化候选②票②），形状与 node-core uploads.WriteFileRangeResponse 单源对齐：
// written 恒在；path 仅首块（offset=0）返回工作区相对路径
export type RpcWriteFileRangeResponse =
    | { success: true; written: number; path?: string }
    | { success: false; error: string }

export type RpcDeleteUploadResponse =
    | { success: true }
    | { success: false; error: string }

// 同 path 原子替换上传响应（「编辑已有上传」场景；content 为 Uint8Array 二进制附件）
export type RpcReplaceUploadResponse =
    | { success: true }
    | { success: false; error: string }

// web 工具配置读取响应（凭据已脱敏；读 settings 失败返回 { error }，与 node-core impl 对齐消 as）
export type RpcGetWebToolsConfigResponse =
    | { config: RedactedWebToolsConfig }
    | { error: string }

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

// 精确 union（深化候选②票②），形状与 node-core sessionFiles.ListSessionFilesResponse 单源对齐：
// truncated/total 仅树浏览路径出现
export type RpcListDirectoryResponse =
    | { success: true; entries: RpcDirectoryEntry[]; truncated?: boolean; total?: number }
    | { success: false; error: string }

export type RpcPathExistsResponse = {
    exists: Record<string, boolean>
}

