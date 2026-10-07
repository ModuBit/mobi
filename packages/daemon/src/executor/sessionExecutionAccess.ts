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
    DiffTarget,
    ReviewActionResult,
    ReviewCommitsResult,
    ReviewContentsResult,
    ReviewFilesResult,
    ReviewOverview,
    ReviewPatchResult,
} from '@mobi/shared'
import type { StoredSession } from '../store/types'
import type { ListHostDirectoryResponse } from '@mobi/node-core/handlers/hostDirectory'
import type {
    ExecutorHost,
    RpcDeleteUploadResponse,
    RpcGetWebToolsConfigResponse,
    RpcListDirectoryResponse,
    RpcReadFileMetaResponse,
    RpcReadFileRangeResponse,
    RpcRefreshMetadataResponse,
    RpcReplaceUploadResponse,
    RpcSaveFileResponse,
    RpcSetWebToolsConfigResponse,
    RpcVerifyWebToolsProviderResponse,
    RpcWriteFileRangeResponse,
} from './executorHost'

/** 寻址数据源最小面（store 直读：cwd 是请求级寻址非热路径，不借道 sessionCache） */
type SessionLookup = { sessions: { getSession(sessionId: string): StoredSession | null } }

/**
 * 会话执行访问 module（深化候选②票①）：daemon 内本机执行消费面的单一入口。
 *
 * 收口此前 routes → SyncEngine → ExecutorHost 的三层透传链——SyncEngine 上 27 个
 * 纯/轻透传方法（session 寻址族 + gitReview 族 + host 直调族 + webTools 配置族）
 * 迁入此处，SyncEngine 只留真编排（spawn/resume/wake/fork/rewind/dormancy 等）。
 *
 * 寻址规则（ADR 0006）：session 寻址、本机执行，无条件单路径——文件/路径类操作
 * 不经会话进程（会话活不活不影响可达性，休眠「冷可读」的地基）；cwd 取会话行
 * metadata.path，缺失显式报错，**不回退 session socket**（双执行路径正是该决策
 * 要消灭的东西）。web 路由直接消费本 module；ExecutorHost 是执行层（票③处置）。
 */
export class SessionExecutionAccess {
    constructor(
        private readonly store: SessionLookup,
        private readonly executor: ExecutorHost,
    ) {}

    /** 会话工作目录解析（session 寻址族的公共前置）：
     *  行不存在 → Session not found；cwd 缺失 → ADR 0006 显式报错（两种失败可分辨） */
    private resolveCwd(sessionId: string): string {
        const session = this.store.sessions.getSession(sessionId)
        if (!session) {
            throw new Error(`Session not found: ${sessionId}`)
        }
        // store 直读拿到的是 raw metadata（不经 sessionCache 的 MetadataSchema safeParse），
        // path 判空在运行时做，不靠类型声明
        const cwd = (session.metadata as { path?: unknown } | null)?.path
        if (typeof cwd !== 'string' || cwd.length === 0) {
            throw new Error(`Session ${sessionId} metadata is missing cwd — file RPC cannot be routed (see ADR 0006)`)
        }
        return cwd
    }

    /** 宽松寻址：行不存在或 cwd 缺失返回 null（不抛、不分原因），供「缺 cwd 不阻塞」
     *  的调用方（如删会话前的快照清理定位）复用同一条寻址规则 */
    tryResolveCwd(sessionId: string): string | null {
        try {
            return this.resolveCwd(sessionId)
        } catch {
            return null
        }
    }

    // ── session 寻址族：resolveCwd → executor（cwd 注入，写边界锚定会话 cwd 子树）──

    async readFileMeta(sessionId: string, path: string): Promise<RpcReadFileMetaResponse> {
        return await this.executor.hostReadFileMeta(this.resolveCwd(sessionId), path)
    }

    async readFileRange(sessionId: string, path: string, offset: number, length: number): Promise<RpcReadFileRangeResponse> {
        return await this.executor.hostReadFileRange(this.resolveCwd(sessionId), path, offset, length)
    }

    /** save-file 同样 host 化（dormancy：冷编辑器自动保存不唤醒） */
    async saveFile(sessionId: string, path: string, content: Uint8Array, baseEtag: string): Promise<RpcSaveFileResponse> {
        return await this.executor.hostSaveFile(this.resolveCwd(sessionId), path, content, baseEtag)
    }

    async searchSessionFiles(sessionId: string, query: string, type?: 'file' | 'directory'): Promise<RpcListDirectoryResponse> {
        return await this.executor.hostSearchFiles(this.resolveCwd(sessionId), query, type)
    }

    async listSessionDirectory(sessionId: string, path: string, prefix?: string): Promise<RpcListDirectoryResponse> {
        return await this.executor.hostListSessionDirectory(this.resolveCwd(sessionId), path, prefix)
    }

    async uploadFileRange(
        sessionId: string,
        filename: string,
        path: string | undefined,
        offset: number,
        content: Uint8Array,
        totalSize?: number,
    ): Promise<RpcWriteFileRangeResponse> {
        return await this.executor.hostUploadFileRange(this.resolveCwd(sessionId), filename, path, offset, content, totalSize)
    }

    async deleteUploadFile(sessionId: string, path: string): Promise<RpcDeleteUploadResponse> {
        return await this.executor.hostDeleteUpload(this.resolveCwd(sessionId), path)
    }

    /** 同 path 原子替换会话机器上的已上传文件（「编辑已有上传」场景） */
    async replaceUploadFile(sessionId: string, path: string, content: Uint8Array): Promise<RpcReplaceUploadResponse> {
        return await this.executor.hostReplaceUpload(this.resolveCwd(sessionId), path, content)
    }

    // ── git 审查族（审查重写 v2 六方法，DiffTarget 统一模型，同 resolveCwd 寻址）──

    async gitReviewOverview(sessionId: string): Promise<ReviewOverview | { success: false; error: string }> {
        return await this.executor.hostGitReviewOverview(this.resolveCwd(sessionId), sessionId)
    }

    async gitReviewFiles(sessionId: string, target: DiffTarget): Promise<ReviewFilesResult | { success: false; error: string }> {
        return await this.executor.hostGitReviewFiles(this.resolveCwd(sessionId), sessionId, target)
    }

    async gitReviewDiff(sessionId: string, target: DiffTarget, path: string): Promise<ReviewPatchResult | { success: false; error: string }> {
        return await this.executor.hostGitReviewDiff(this.resolveCwd(sessionId), sessionId, target, path)
    }

    async gitReviewContents(sessionId: string, target: DiffTarget, path: string): Promise<ReviewContentsResult | { success: false; error: string }> {
        return await this.executor.hostGitReviewContents(this.resolveCwd(sessionId), sessionId, target, path)
    }

    async gitReviewCommits(sessionId: string, cursor?: string): Promise<ReviewCommitsResult | { success: false; error: string }> {
        return await this.executor.hostGitReviewCommits(this.resolveCwd(sessionId), cursor)
    }

    async gitReviewInit(sessionId: string): Promise<ReviewActionResult | { success: false; error: string }> {
        return await this.executor.hostGitReviewInit(this.resolveCwd(sessionId))
    }

    // ── host 直调族：无会话寻址（web 端点自带 cwd/homeDir），纯转发 ──

    async checkPathsExist(paths: string[]): Promise<Record<string, boolean>> {
        return await this.executor.checkPathsExist(paths)
    }

    /** host 通道读文件元信息（跨会话存活的静态资源读取） */
    async hostReadFileMeta(cwd: string, path: string): Promise<RpcReadFileMetaResponse> {
        return await this.executor.hostReadFileMeta(cwd, path)
    }

    /** host 通道分片读文件 */
    async hostReadFileRange(cwd: string, path: string, offset: number, length: number): Promise<RpcReadFileRangeResponse> {
        return await this.executor.hostReadFileRange(cwd, path, offset, length)
    }

    async hostSearchFiles(cwd: string, query: string, type?: 'file' | 'directory'): Promise<RpcListDirectoryResponse> {
        return await this.executor.hostSearchFiles(cwd, query, type)
    }

    async hostListSessionDirectory(cwd: string, path: string, prefix?: string): Promise<RpcListDirectoryResponse> {
        return await this.executor.hostListSessionDirectory(cwd, path, prefix)
    }

    async listHostDirectory(path: string, homeDir: string): Promise<ListHostDirectoryResponse> {
        return await this.executor.listHostDirectory(path, homeDir)
    }

    async hostUploadFileRange(
        cwd: string,
        filename: string,
        path: string | undefined,
        offset: number,
        content: Uint8Array,
        totalSize?: number,
    ): Promise<RpcWriteFileRangeResponse> {
        return await this.executor.hostUploadFileRange(cwd, filename, path, offset, content, totalSize)
    }

    async hostDeleteUpload(cwd: string, path: string): Promise<RpcDeleteUploadResponse> {
        return await this.executor.hostDeleteUpload(cwd, path)
    }

    /** 同 path 原子替换已上传文件 */
    async hostReplaceUpload(cwd: string, path: string, content: Uint8Array): Promise<RpcReplaceUploadResponse> {
        return await this.executor.hostReplaceUpload(cwd, path, content)
    }

    async hostRefreshMetadata(cwd: string): Promise<RpcRefreshMetadataResponse> {
        return await this.executor.hostRefreshMetadata(cwd)
    }

    // ── web 工具配置族（纯透传，daemon 不存任何 web 工具状态）──

    async getWebToolsConfig(): Promise<RpcGetWebToolsConfigResponse> {
        return await this.executor.getWebToolsConfig()
    }

    async setWebToolsConfig(config: unknown): Promise<RpcSetWebToolsConfigResponse> {
        return await this.executor.setWebToolsConfig(config)
    }

    /** Web 工具 provider 验证连接（草稿凭据优先，不落盘） */
    async verifyWebToolsProvider(
        providerId: string,
        credentials?: Record<string, string>,
    ): Promise<RpcVerifyWebToolsProviderResponse> {
        return await this.executor.verifyWebToolsProvider(providerId, credentials)
    }
}
