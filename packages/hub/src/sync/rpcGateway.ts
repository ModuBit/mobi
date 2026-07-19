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

import type { EffortLevel, PermissionMode, SDKMetadata } from '@mobi/shared/types'
import type { Server } from 'socket.io'
import type { RpcRegistry } from '../socket/rpcRegistry'

export type RpcRefreshMetadataResponse = {
    success: boolean
    metadata?: SDKMetadata
    error?: string
}

export type RpcCommandResponse = {
    success: boolean
    stdout?: string
    stderr?: string
    exitCode?: number
    error?: string
}

// 文件元数据（流式读取前置查询）
export type RpcFileMeta = { mime: string; size: number; etag: string }
export type RpcReadFileMetaResponse = {
    success: boolean
    meta?: RpcFileMeta
    error?: string
}

// 文件范围读取响应（chunk 为二进制，经 Socket.IO 原生序列化原样透传）
export type RpcReadFileRangeResponse = {
    success: boolean
    chunk?: Uint8Array
    error?: string
}

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

export type RpcDirectoryEntry = {
    name: string
    type: 'file' | 'directory' | 'other'
    size?: number
    modified?: number
}

export type RpcListDirectoryResponse = {
    success: boolean
    entries?: RpcDirectoryEntry[]
    error?: string
}

export type RpcPathExistsResponse = {
    exists: Record<string, boolean>
}

export class RpcGateway {
    constructor(
        private readonly io: Server,
        private readonly rpcRegistry: RpcRegistry
    ) {
    }

    async approvePermission(
        sessionId: string,
        requestId: string,
        mode?: PermissionMode,
        allowTools?: string[],
        decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort',
        answers?: Record<string, string | string[]> | Record<string, { answers: string[] }>
    ): Promise<void> {
        await this.sessionRpc(sessionId, 'permission', {
            id: requestId,
            approved: true,
            mode,
            allowTools,
            decision,
            answers
        })
    }

    async denyPermission(
        sessionId: string,
        requestId: string,
        decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort',
        reason?: string
    ): Promise<void> {
        await this.sessionRpc(sessionId, 'permission', {
            id: requestId,
            approved: false,
            decision,
            reason
        })
    }

    async abortSession(sessionId: string): Promise<void> {
        await this.sessionRpc(sessionId, 'abort', { reason: 'User aborted via Mobi' })
    }

    async switchSession(sessionId: string, to: 'remote' | 'local'): Promise<void> {
        await this.sessionRpc(sessionId, 'switch', { to })
    }

    async requestSessionConfig(
        sessionId: string,
        config: {
            permissionMode?: PermissionMode
            model?: string | null
            effort?: EffortLevel
        }
    ): Promise<unknown> {
        return await this.sessionRpc(sessionId, 'set-session-config', config)
    }

    async killSession(sessionId: string): Promise<void> {
        await this.sessionRpc(sessionId, 'killSession', {})
    }

    async spawnSession(
        machineId: string,
        directory: string,
        agent: 'claude' = 'claude',  // Mobi 当前仅支持 Claude
        model?: string,
        permissionMode?: PermissionMode,
        sessionType?: 'simple' | 'worktree',
        worktreeName?: string,
        resumeSessionId?: string,
        effort?: string,
    ): Promise<{ type: 'success'; sessionId: string } | { type: 'error'; message: string }> {
        try {
            const result = await this.machineRpc(
                machineId,
                'spawn-mobi-session',
                { type: 'spawn-in-directory', directory, agent, model, permissionMode, sessionType, worktreeName, resumeSessionId, effort }
            )
            if (result && typeof result === 'object') {
                const obj = result as Record<string, unknown>
                if (obj.type === 'success' && typeof obj.sessionId === 'string') {
                    return { type: 'success', sessionId: obj.sessionId }
                }
                if (obj.type === 'error' && typeof obj.errorMessage === 'string') {
                    return { type: 'error', message: obj.errorMessage }
                }
                if (obj.type === 'requestToApproveDirectoryCreation' && typeof obj.directory === 'string') {
                    return { type: 'error', message: `Directory creation requires approval: ${obj.directory}` }
                }
                if (typeof obj.error === 'string') {
                    return { type: 'error', message: obj.error }
                }
                if (obj.type !== 'success' && typeof obj.message === 'string') {
                    return { type: 'error', message: obj.message }
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
            return { type: 'error', message: `Unexpected spawn result: ${details}` }
        } catch (error) {
            return { type: 'error', message: error instanceof Error ? error.message : String(error) }
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

    async getGitStatus(sessionId: string, cwd?: string): Promise<RpcCommandResponse> {
        return await this.sessionRpc(sessionId, 'git-status', { cwd }) as RpcCommandResponse
    }

    async getGitDiffNumstat(sessionId: string, options: { cwd?: string; staged?: boolean }): Promise<RpcCommandResponse> {
        return await this.sessionRpc(sessionId, 'git-diff-numstat', options) as RpcCommandResponse
    }

    async getGitDiffFile(sessionId: string, options: { cwd?: string; filePath: string; staged?: boolean }): Promise<RpcCommandResponse> {
        return await this.sessionRpc(sessionId, 'git-diff-file', options) as RpcCommandResponse
    }

    // 查询文件元数据（mime/size/etag），用于流式读取前置判断
    async readFileMeta(sessionId: string, path: string): Promise<RpcReadFileMetaResponse> {
        return await this.sessionRpc(sessionId, 'readFileMeta', { path }) as RpcReadFileMetaResponse
    }

    // 范围读取文件二进制 chunk
    async readFileRange(sessionId: string, path: string, offset: number, length: number): Promise<RpcReadFileRangeResponse> {
        return await this.sessionRpc(sessionId, 'readFileRange', { path, offset, length }) as RpcReadFileRangeResponse
    }

    async listDirectory(sessionId: string, path: string): Promise<RpcListDirectoryResponse> {
        return await this.sessionRpc(sessionId, 'listDirectory', { path }) as RpcListDirectoryResponse
    }

    async searchSessionFiles(sessionId: string, query: string, type?: 'file' | 'directory'): Promise<RpcListDirectoryResponse> {
        return await this.sessionRpc(sessionId, 'searchSessionFiles', { query, type }) as RpcListDirectoryResponse
    }

    async listSessionDirectory(sessionId: string, path: string, prefix?: string): Promise<RpcListDirectoryResponse> {
        return await this.sessionRpc(sessionId, 'listSessionDirectory', { path, prefix }) as RpcListDirectoryResponse
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

    // 在 machine 上搜索文件
    async machineSearchFiles(machineId: string, cwd: string, query: string): Promise<RpcListDirectoryResponse> {
        return await this.machineRpc(machineId, 'searchSessionFiles', { cwd, query }) as RpcListDirectoryResponse
    }

    // 列出 machine 会话目录
    async machineListSessionDirectory(machineId: string, cwd: string, path: string, prefix?: string): Promise<RpcListDirectoryResponse> {
        return await this.machineRpc(machineId, 'listSessionDirectory', { cwd, path, prefix }) as RpcListDirectoryResponse
    }

    // 刷新 machine 上的会话元数据
    async machineRefreshMetadata(machineId: string, cwd: string): Promise<RpcRefreshMetadataResponse> {
        return await this.machineRpc(machineId, 'refreshMetadata', { cwd }) as RpcRefreshMetadataResponse
    }

    // 文件流式上传（Uint8Array 二进制附件，非 base64）
    async uploadFileRange(
        sessionId: string,
        filename: string,
        path: string | undefined,
        offset: number,
        content: Uint8Array,
        totalSize?: number,
    ): Promise<RpcWriteFileRangeResponse> {
        return await this.sessionRpc(sessionId, 'writeFileRange', { sessionId, filename, path, offset, content, totalSize }) as RpcWriteFileRangeResponse
    }

    async deleteUploadFile(sessionId: string, path: string): Promise<RpcDeleteUploadResponse> {
        return await this.sessionRpc(sessionId, 'deleteUpload', { sessionId, path }) as RpcDeleteUploadResponse
    }

    async runRipgrep(sessionId: string, args: string[], cwd?: string): Promise<RpcCommandResponse> {
        return await this.sessionRpc(sessionId, 'ripgrep', { args, cwd }) as RpcCommandResponse
    }

    async refreshMetadata(sessionId: string): Promise<RpcRefreshMetadataResponse> {
        return await this.sessionRpc(sessionId, 'refreshMetadata', {}) as RpcRefreshMetadataResponse
    }

    // 停止后台任务
    async stopTask(sessionId: string, taskId: string): Promise<void> {
        await this.sessionRpc(sessionId, 'stop-task', { taskId })
    }

    // 取消 CLI 内存队列中已缓冲的排队消息（两阶段取消的 CLI 侧）
    async cancelCliQueuedMessage(sessionId: string, localId: string): Promise<{ status: 'cancelled' | 'submitted' }> {
        const res = await this.sessionRpc(sessionId, 'cancel-queued-message', { localId })
        return (res ?? { status: 'submitted' }) as { status: 'cancelled' | 'submitted' }
    }

    // steer CLI 内存队列中的排队消息：立即提交给 SDK input stream
    async steerCliQueuedMessage(sessionId: string, localId: string): Promise<{ status: 'steered' | 'submitted' }> {
        const res = await this.sessionRpc(sessionId, 'steer-queued-message', { localId })
        return (res ?? { status: 'submitted' }) as { status: 'steered' | 'submitted' }
    }

    private async sessionRpc(sessionId: string, method: string, params: unknown): Promise<unknown> {
        return await this.rpcCall(`${sessionId}:${method}`, params)
    }

    private async machineRpc(machineId: string, method: string, params: unknown): Promise<unknown> {
        return await this.rpcCall(`${machineId}:${method}`, params)
    }

    private async rpcCall(method: string, params: unknown): Promise<unknown> {
        const socketId = this.rpcRegistry.getSocketIdForMethod(method)
        if (!socketId) {
            throw new Error(`RPC handler not registered: ${method}`)
        }

        const socket = this.io.of('/cli').sockets.get(socketId)
        if (!socket) {
            throw new Error(`RPC socket disconnected: ${method}`)
        }

        // Socket.IO 原生序列化：params 对象直传，响应对象直收（含二进制附件）
        const response = await socket.timeout(30_000).emitWithAck('rpc-request', {
            method,
            params
        }) as unknown

        return response
    }
}
