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

export type RpcReadFileResponse = {
    success: boolean
    content?: string
    error?: string
}

export type RpcUploadFileResponse = {
    success: boolean
    path?: string
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
        answers?: Record<string, string[]> | Record<string, { answers: string[] }>
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
        decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort'
    ): Promise<void> {
        await this.sessionRpc(sessionId, 'permission', {
            id: requestId,
            approved: false,
            decision
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
        yolo?: boolean,
        sessionType?: 'simple' | 'worktree',
        worktreeName?: string,
        resumeSessionId?: string,
        effort?: string,
    ): Promise<{ type: 'success'; sessionId: string } | { type: 'error'; message: string }> {
        try {
            const result = await this.machineRpc(
                machineId,
                'spawn-mobi-session',
                { type: 'spawn-in-directory', directory, agent, model, yolo, sessionType, worktreeName, resumeSessionId, effort }
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

    async readSessionFile(sessionId: string, path: string): Promise<RpcReadFileResponse> {
        return await this.sessionRpc(sessionId, 'readFile', { path }) as RpcReadFileResponse
    }

    async listDirectory(sessionId: string, path: string): Promise<RpcListDirectoryResponse> {
        return await this.sessionRpc(sessionId, 'listDirectory', { path }) as RpcListDirectoryResponse
    }

    async searchSessionFiles(sessionId: string, query: string): Promise<RpcListDirectoryResponse> {
        return await this.sessionRpc(sessionId, 'searchSessionFiles', { query }) as RpcListDirectoryResponse
    }

    async listSessionDirectory(sessionId: string, path: string): Promise<RpcListDirectoryResponse> {
        return await this.sessionRpc(sessionId, 'listSessionDirectory', { path }) as RpcListDirectoryResponse
    }

    async listMachineDirectory(machineId: string, path: string, homeDir: string): Promise<RpcListDirectoryResponse> {
        return await this.machineRpc(machineId, 'list-directory', { path, homeDir }) as RpcListDirectoryResponse
    }

    async uploadFile(sessionId: string, filename: string, content: string, mimeType: string): Promise<RpcUploadFileResponse> {
        return await this.sessionRpc(sessionId, 'uploadFile', { sessionId, filename, content, mimeType }) as RpcUploadFileResponse
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

        const response = await socket.timeout(30_000).emitWithAck('rpc-request', {
            method,
            params: JSON.stringify(params)
        }) as unknown

        if (typeof response !== 'string') {
            return response
        }

        try {
            return JSON.parse(response) as unknown
        } catch {
            return response
        }
    }
}
