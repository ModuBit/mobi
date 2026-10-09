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
 * 本机执行层（深化候选②票③）：原 ExecutorHost 接口随 wire 协议遗物身份删除——
 * 单 adapter 的假想 seam 不再存在，测试注入走 ExecutorBridge（生产/测试两个
 * adapter，真 seam）。直调 node-core handlers 实现函数（socket 版实现随 machine
 * 通道删除）；machineId 形参已随单机化收窄（602），无路由标识。
 */

import { homedir } from 'node:os'
import { GIT_REVIEW_RPC, type DiffTarget, type ReviewActionResult, type ReviewCommitsResult, type ReviewContentsResult, type ReviewFilesResult, type ReviewOverview, type ReviewPatchResult } from '@mobi/shared'
import { checkPathsExistImpl } from '@mobi/node-core/handlers/pathExists'
import { hostReadFileMetaImpl, hostReadFileRangeImpl } from '@mobi/node-core/handlers/hostFiles'
import { saveFileImpl } from '@mobi/node-core/handlers/files'
import { writeFileRangeImpl, deleteUploadImpl, replaceUploadImpl } from '@mobi/node-core/handlers/uploads'
import { listHostDirectoryImpl } from '@mobi/node-core/handlers/hostDirectory'
import { searchSessionFilesImpl, listSessionDirectoryImpl } from '@mobi/node-core/handlers/sessionFiles'
import { gitReviewRpcImpl } from '@mobi/node-core/handlers/gitReview'
import { getWebToolsConfigImpl, setWebToolsConfigImpl, verifyWebToolsProviderImpl } from '@mobi/node-core/handlers/webToolsConfig'
import { refreshMetadataImpl } from '@mobi/node-core/handlers/commands'
import type { RpcGetWebToolsConfigResponse, RpcRefreshMetadataResponse, SpawnSessionOptions } from './executorHost'
import { mapSpawnResultToGateway } from './spawnResultMapping'
import type { ExecutorBridge } from '../executor/lifecycle'

export class LocalExecutor {
    /** 会话执行桥（ticket-18 spawn 直调）；daemon 编排在 executor 就绪后注入 */
    private readonly executorBridge: () => ExecutorBridge | null

    constructor(executorBridge: () => ExecutorBridge | null = () => null) {
        this.executorBridge = executorBridge
    }

    async spawnSession(directory: string, options?: SpawnSessionOptions) {
        const bridge = this.executorBridge()
        if (!bridge) {
            // socket 兜底已随 machine 通道删除（ticket-20）：bridge 注入前（daemon 启动窗口）
            // 或脱离 daemon 的调用方会到这里，按明确错误透出而非静默等待
            return { type: 'error' as const, message: 'Executor bridge is not wired', failure: 'other' as const }
        }
        const { agent = 'claude', sessionId, model, permissionMode, sessionType, worktreeName, resumeSessionId, effort, outputStyle, workspaceId } = options ?? {}
        try {
            // 直调 executor 核心（同一份 spawnSession 闭包，dedup/目录建/worktree/webhook 等待全同源）；
            // 结果归一映射与 socket 路径共用单源
            const result = await bridge.spawnSession({ type: 'spawn-in-directory', directory, sessionId, agent, model, permissionMode, sessionType, worktreeName, resumeSessionId, effort, outputStyle, workspaceId } as never)
            return mapSpawnResultToGateway(result)
        } catch (error) {
            // 直调不会抛 RpcFailure（transport 不存在了）；executor 闭包自身全捕获。
            // 万一抛出（未来改动引入）：按 other 归类，不给跨进程散文猜分类留后路
            const message = error instanceof Error ? error.message : String(error)
            return { type: 'error' as const, message, failure: 'other' as const }
        }
    }

    // ── 文件读组（ticket-17 组1：本地直调，不经 socket loopback）──

    async checkPathsExist(paths: string[]) {
        const result = await checkPathsExistImpl({ paths })
        // socket 版对回执做布尔归一（信任边界），本地直调结果同样归一保持同构
        const exists: Record<string, boolean> = {}
        for (const [key, value] of Object.entries(result.exists)) {
            exists[key] = value === true
        }
        return exists
    }

    async hostReadFileMeta(cwd: string, path: string) {
        return await hostReadFileMetaImpl({ cwd, path }, homedir())
    }

    async hostReadFileRange(cwd: string, path: string, offset: number, length: number) {
        return await hostReadFileRangeImpl({ cwd, path, offset, length }, homedir())
    }

    // ── git 审查族（ticket-17 组4：本地直调，方法表查表单源）──
    // gitReviewRpcImpl 按 method 动态查表只能返回宽集，窄化 as 收敛到这一个 helper（深化候选②票②）：
    // 每方法的精确返回类型由调用方类型参数声明，与 GIT_REVIEW_HANDLERS 表内 run 的返回一致
    private async callGitReview<T>(method: string, data: { cwd: string } & Record<string, unknown>): Promise<T | { success: false; error: string }> {
        return await gitReviewRpcImpl(method, data) as T | { success: false; error: string }
    }

    async hostGitReviewOverview(cwd: string, sessionId: string) {
        return await this.callGitReview<ReviewOverview>(GIT_REVIEW_RPC.overview, { cwd, sessionId })
    }

    async hostGitReviewFiles(cwd: string, sessionId: string, target: DiffTarget) {
        return await this.callGitReview<ReviewFilesResult>(GIT_REVIEW_RPC.files, { cwd, sessionId, target })
    }

    async hostGitReviewDiff(cwd: string, sessionId: string, target: DiffTarget, path: string) {
        return await this.callGitReview<ReviewPatchResult>(GIT_REVIEW_RPC.diff, { cwd, sessionId, target, path })
    }

    async hostGitReviewContents(cwd: string, sessionId: string, target: DiffTarget, path: string) {
        return await this.callGitReview<ReviewContentsResult>(GIT_REVIEW_RPC.contents, { cwd, sessionId, target, path })
    }

    async hostGitReviewCommits(cwd: string, cursor?: string) {
        return await this.callGitReview<ReviewCommitsResult>(GIT_REVIEW_RPC.commits, { cwd, cursor })
    }

    async hostGitReviewInit(cwd: string) {
        return await this.callGitReview<ReviewActionResult>(GIT_REVIEW_RPC.init, { cwd })
    }

    async clearTurnSnapshots(cwd: string, sessionId: string) {
        await gitReviewRpcImpl(GIT_REVIEW_RPC.clear, { cwd, sessionId })
    }

    // ── 写/上传组（ticket-17 组2：本地直调）──
    // 回退 workingDirectory 仅在 cwd 缺省时生效；调用方（SessionExecutionAccess）恒注入 cwd，回退不参与语义
    async hostSaveFile(cwd: string, path: string, content: Uint8Array, baseEtag: string) {
        return await saveFileImpl({ cwd, path, content, baseEtag }, homedir(), homedir())
    }

    // ── 目录与搜索组（ticket-17 组3：本地直调）──

    // 返回形状单源 node-core ListHostDirectoryResponse（条目仅 name），无 as
    async listHostDirectory(path: string, homeDir: string) {
        return await listHostDirectoryImpl({ path, homeDir })
    }

    async hostUploadFileRange(
        cwd: string,
        filename: string,
        path: string | undefined,
        offset: number,
        content: Uint8Array,
        totalSize?: number,
    ) {
        return await writeFileRangeImpl({ cwd, filename, path, offset, content, totalSize }, homedir())
    }

    async hostDeleteUpload(cwd: string, path: string) {
        return await deleteUploadImpl({ cwd, path }, homedir())
    }

    async hostReplaceUpload(cwd: string, path: string, content: Uint8Array) {
        return await replaceUploadImpl({ cwd, path, content }, homedir())
    }

    // ── web-tools + metadata 组（ticket-17 组5：本地直调）──

    // 返回形状与 node-core impl 对齐（{config} | {error}），无 as
    async getWebToolsConfig(): Promise<RpcGetWebToolsConfigResponse> {
        return await getWebToolsConfigImpl()
    }

    async setWebToolsConfig(config: unknown) {
        return await setWebToolsConfigImpl({ config })
    }

    async verifyWebToolsProvider(providerId: string, credentials?: Record<string, string>) {
        return await verifyWebToolsProviderImpl({ providerId: providerId as never, credentials })
    }

    async hostSearchFiles(cwd: string, query: string, type?: 'file' | 'directory') {
        return await searchSessionFilesImpl({ cwd, query, type }, homedir())
    }

    async hostListSessionDirectory(cwd: string, path: string, prefix?: string) {
        return await listSessionDirectoryImpl({ cwd, path, prefix }, homedir())
    }

    async hostRefreshMetadata(cwd: string): Promise<RpcRefreshMetadataResponse> {
        return await refreshMetadataImpl({ cwd })
    }
}
