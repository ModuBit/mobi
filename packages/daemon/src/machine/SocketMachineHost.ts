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
 * {@link MachineHost} 的首个实现（ticket-15）：把现有 machine 通道 RPC 原样包一层，
 * 方法体逐一自 rpcGateway 搬入，行为零变化。④ 后续票在此类内逐项换本地实现，
 * 调用方（syncEngine 透传 / agentSessions）不动。
 */

import { GIT_REVIEW_RPC, type DiffTarget, type ReviewActionResult, type ReviewCommitsResult, type ReviewContentsResult, type ReviewFilesResult, type ReviewOverview, type ReviewPatchResult } from '@mobi/shared'
import type { RpcRegistry } from '../socket/rpcRegistry'
import type { Server } from 'socket.io'
import { readRpcFailure } from '../sync/rpcFailure'
import { classifyTransportFailure, SocketRpcCaller } from '../sync/rpcCaller'
import type {
    MachineHost,
    RpcDeleteUploadResponse,
    RpcGetWebToolsConfigResponse,
    RpcListDirectoryResponse,
    RpcPathExistsResponse,
    RpcReadFileMetaResponse,
    RpcReadFileRangeResponse,
    RpcRefreshMetadataResponse,
    RpcReplaceUploadResponse,
    RpcSaveFileResponse,
    RpcSetWebToolsConfigResponse,
    RpcVerifyWebToolsProviderResponse,
    RpcWriteFileRangeResponse,
    SpawnGatewayResult,
    SpawnSessionOptions
} from './MachineHost'

export class SocketMachineHost implements MachineHost {
    private readonly caller: SocketRpcCaller

    constructor(io: Server, rpcRegistry: RpcRegistry) {
        this.caller = new SocketRpcCaller(io, rpcRegistry)
    }

    private async machineRpc(machineId: string, method: string, params: unknown): Promise<unknown> {
        return await this.caller.call(`${machineId}:${method}`, params)
    }

    /**
     * 在 machine 上起一个会话进程。
     *
     * 失败支**带上传输分类**（`failure`）：这条链路里混着三种来路的句子——rpcCall 抛的
     * 分类错、runner 自己产的人话（目录建不出来 / 进程起来就退出 / 等会话 webhook 超时）、
     * 以及这里合成的几句话。分类在**产生它的这一层**一次定完，调用方按 kind 分支、
     * 按 message 说话，不必再读句子（见 rpcFailure 模块头）。
     */
    async spawnSession(
        machineId: string,
        directory: string,
        options: SpawnSessionOptions = {},
    ): Promise<SpawnGatewayResult> {
        // 文字来路的失败统一走这里：上游的人话多半归 'other'（原样透出），
        // 只有 runner 等 webhook 超时那一句会被读成 'timeout'
        const spawnError = (message: string) => ({ type: 'error' as const, message, failure: classifyTransportFailure(message) })
        const { agent = 'claude', model, permissionMode, sessionType, worktreeName, resumeSessionId, effort, outputStyle, workspaceId } = options
        try {
            const result = await this.machineRpc(
                machineId,
                'spawn-mobi-session',
                { type: 'spawn-in-directory', directory, agent, model, permissionMode, sessionType, worktreeName, resumeSessionId, effort, outputStyle, workspaceId }
            )
            if (result && typeof result === 'object') {
                const obj = result as Record<string, unknown>
                if (obj.type === 'success' && typeof obj.sessionId === 'string') {
                    return { type: 'success', sessionId: obj.sessionId }
                }
                if (obj.type === 'already-running') {
                    return { type: 'already-running' }
                }
                if (obj.type === 'error' && typeof obj.errorMessage === 'string') {
                    return spawnError(obj.errorMessage)
                }
                if (obj.type === 'requestToApproveDirectoryCreation' && typeof obj.directory === 'string') {
                    return spawnError(`Directory creation requires approval: ${obj.directory}`)
                }
                if (typeof obj.error === 'string') {
                    return spawnError(obj.error)
                }
                if (obj.type !== 'success' && typeof obj.message === 'string') {
                    return spawnError(obj.message)
                }
            }
            const details = typeof result === 'string'
                ? result
                : (() => {
                    try {
                        return JSON.stringify(result)
                    } catch {
                        return String(result)
                    }
                })()
            return spawnError(`Unexpected spawn result: ${details}`)
        } catch (error) {
            // 走到这里的是调用器抛的 RpcFailure，分类已经带着（本方法其余部分不抛）。
            // 万一不是：readRpcFailure 读成 'other'——hub 自己抛的错不该被当跨进程散文猜
            const { kind, message } = readRpcFailure(error)
            return { type: 'error', message, failure: kind }
        }
    }

    async checkPathsExist(machineId: string, paths: string[]): Promise<Record<string, boolean>> {
        const result = await this.machineRpc(machineId, 'path-exists', { paths }) as RpcPathExistsResponse | unknown
        if (!result || typeof result !== 'object') {
            throw new Error('Unexpected path-exists result')
        }

        const existsValue = (result as RpcPathExistsResponse).exists
        if (!existsValue || typeof existsValue !== 'object') {
            throw new Error('Unexpected path-exists result')
        }

        const exists: Record<string, boolean> = {}
        for (const [key, value] of Object.entries(existsValue)) {
            exists[key] = value === true
        }
        return exists
    }

    // machine 通道读文件 meta（cwd 显式参数化，读边界同 validateReadPath，ADR 0006）。
    // 服务跨会话存活的静态资源读取（消息附件预览），与会话进程存活解耦；
    // 返回的 mime/size/etag 用于流式读取前置判断
    async machineReadFileMeta(machineId: string, cwd: string, path: string): Promise<RpcReadFileMetaResponse> {
        return await this.machineRpc(machineId, 'readFileMeta', { cwd, path }) as RpcReadFileMetaResponse
    }

    // machine 通道分片读文件（同上）
    async machineReadFileRange(machineId: string, cwd: string, path: string, offset: number, length: number): Promise<RpcReadFileRangeResponse> {
        return await this.machineRpc(machineId, 'readFileRange', { cwd, path, offset, length }) as RpcReadFileRangeResponse
    }

    // ── 审查重写 v2 六方法（DiffTarget 统一模型）：纯转发，git 事实全部在 CLI 侧 ──
    async machineGitReviewOverview(machineId: string, cwd: string, sessionId: string): Promise<ReviewOverview | { success: false; error: string }> {
        return await this.machineRpc(machineId, GIT_REVIEW_RPC.overview, { cwd, sessionId }) as ReviewOverview | { success: false; error: string }
    }

    async machineGitReviewFiles(machineId: string, cwd: string, sessionId: string, target: DiffTarget): Promise<ReviewFilesResult | { success: false; error: string }> {
        return await this.machineRpc(machineId, GIT_REVIEW_RPC.files, { cwd, sessionId, target }) as ReviewFilesResult | { success: false; error: string }
    }

    async machineGitReviewDiff(machineId: string, cwd: string, sessionId: string, target: DiffTarget, path: string): Promise<ReviewPatchResult | { success: false; error: string }> {
        return await this.machineRpc(machineId, GIT_REVIEW_RPC.diff, { cwd, sessionId, target, path }) as ReviewPatchResult | { success: false; error: string }
    }

    async machineGitReviewContents(machineId: string, cwd: string, sessionId: string, target: DiffTarget, path: string): Promise<ReviewContentsResult | { success: false; error: string }> {
        return await this.machineRpc(machineId, GIT_REVIEW_RPC.contents, { cwd, sessionId, target, path }) as ReviewContentsResult | { success: false; error: string }
    }

    async machineGitReviewCommits(machineId: string, cwd: string, cursor?: string): Promise<ReviewCommitsResult | { success: false; error: string }> {
        return await this.machineRpc(machineId, GIT_REVIEW_RPC.commits, { cwd, cursor }) as ReviewCommitsResult | { success: false; error: string }
    }

    async machineGitReviewInit(machineId: string, cwd: string): Promise<ReviewActionResult | { success: false; error: string }> {
        return await this.machineRpc(machineId, GIT_REVIEW_RPC.init, { cwd }) as ReviewActionResult | { success: false; error: string }
    }

    // 会话删除后清理轮次快照引用（ADR 0008 refs 治理）；best-effort，失败由调用方 warn
    async clearTurnSnapshots(machineId: string, cwd: string, sessionId: string): Promise<void> {
        await this.machineRpc(machineId, GIT_REVIEW_RPC.clear, { cwd, sessionId })
    }

    // 保存文件到原路径（覆盖已存在 + etag OCC；content 为二进制附件原样透传）。
    // ADR 0006 + dormancy spec §E：写边界锚定由 hub 注入 cwd 保证（runner 侧 validateWritePath
    // 以 cwd 为根），会话进程不在也可写（冷编辑器自动保存不唤醒）
    async machineSaveFile(machineId: string, cwd: string, path: string, content: Uint8Array, baseEtag: string): Promise<RpcSaveFileResponse> {
        return await this.machineRpc(machineId, 'saveFile', { cwd, path, content, baseEtag }) as RpcSaveFileResponse
    }

    async listMachineDirectory(machineId: string, path: string, homeDir: string): Promise<RpcListDirectoryResponse> {
        return await this.machineRpc(machineId, 'list-directory', { path, homeDir }) as RpcListDirectoryResponse
    }

    // 文件流式上传到 machine 指定目录（Uint8Array 二进制附件，非 base64）
    async machineUploadFileRange(
        machineId: string,
        cwd: string,
        filename: string,
        path: string | undefined,
        offset: number,
        content: Uint8Array,
        totalSize?: number,
    ): Promise<RpcWriteFileRangeResponse> {
        return await this.machineRpc(machineId, 'writeFileRange', { cwd, filename, path, offset, content, totalSize }) as RpcWriteFileRangeResponse
    }

    // 删除 machine 上的已上传文件
    async machineDeleteUpload(machineId: string, cwd: string, path: string): Promise<RpcDeleteUploadResponse> {
        return await this.machineRpc(machineId, 'deleteUpload', { cwd, path }) as RpcDeleteUploadResponse
    }

    // 同 path 原子替换 machine 上的已上传文件
    async machineReplaceUpload(machineId: string, cwd: string, path: string, content: Uint8Array): Promise<RpcReplaceUploadResponse> {
        return await this.machineRpc(machineId, 'replaceUpload', { cwd, path, content }) as RpcReplaceUploadResponse
    }

    // web 工具配置读写（runner 落盘，会话进程惰性读生效）
    async getWebToolsConfig(machineId: string): Promise<RpcGetWebToolsConfigResponse> {
        return await this.machineRpc(machineId, 'get-web-tools-config', {}) as RpcGetWebToolsConfigResponse
    }

    async setWebToolsConfig(machineId: string, config: unknown): Promise<RpcSetWebToolsConfigResponse> {
        return await this.machineRpc(machineId, 'set-web-tools-config', { config }) as RpcSetWebToolsConfigResponse
    }

    // web 工具 provider 验证连接（草稿凭据优先于已存值，runner 不落盘）
    async verifyWebToolsProvider(
        machineId: string,
        providerId: string,
        credentials?: Record<string, string>,
    ): Promise<RpcVerifyWebToolsProviderResponse> {
        return await this.machineRpc(machineId, 'verify-web-tools-provider', { providerId, credentials }) as RpcVerifyWebToolsProviderResponse
    }

    // 在 machine 上搜索文件（type 与 session 路由同参：'file' | 'directory' 过滤，缺省=目录+文件合并）
    async machineSearchFiles(machineId: string, cwd: string, query: string, type?: 'file' | 'directory'): Promise<RpcListDirectoryResponse> {
        return await this.machineRpc(machineId, 'searchSessionFiles', { cwd, query, type }) as RpcListDirectoryResponse
    }

    // 列出 machine 会话目录
    async machineListSessionDirectory(machineId: string, cwd: string, path: string, prefix?: string): Promise<RpcListDirectoryResponse> {
        return await this.machineRpc(machineId, 'listSessionDirectory', { cwd, path, prefix }) as RpcListDirectoryResponse
    }

    // 刷新 machine 上的会话元数据
    async machineRefreshMetadata(machineId: string, cwd: string): Promise<RpcRefreshMetadataResponse> {
        return await this.machineRpc(machineId, 'refreshMetadata', { cwd }) as RpcRefreshMetadataResponse
    }
}
