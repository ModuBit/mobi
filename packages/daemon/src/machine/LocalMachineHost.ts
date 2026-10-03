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
 * {@link MachineHost} 的本地实现（ticket-17，WP4.3）：直调 machine handlers 的
 * 实现函数，替换经 socket loopback 的 {@link SocketMachineHost}。
 *
 * 绞杀者模式逐组切换：每个方法组一个提交从「委托 fallback」翻成「直调」，
 * fallback 常驻兜底——已切换方法不再出现 `unreachable` 与 30s 传输超时
 * （07 N），`RpcFailure` 结果结构与 `kind` 分类语义保持（调用方分支不动，25 票清）。
 *
 * `machineId` 形参保留（D4=C 路由残留），本地实现忽略之。
 */

import { homedir } from 'node:os'
import { GIT_REVIEW_RPC, type DiffTarget, type ReviewActionResult, type ReviewCommitsResult, type ReviewContentsResult, type ReviewFilesResult, type ReviewOverview, type ReviewPatchResult } from '@mobi/shared'
import { checkPathsExistImpl } from '@mobi/node-core/handlers/pathExists'
import { machineReadFileMetaImpl, machineReadFileRangeImpl } from '@mobi/node-core/handlers/machineFiles'
import { saveFileImpl } from '@mobi/node-core/handlers/files'
import { writeFileRangeImpl, deleteUploadImpl, replaceUploadImpl } from '@mobi/node-core/handlers/uploads'
import { listMachineDirectoryImpl } from '@mobi/node-core/handlers/machineDirectory'
import { searchSessionFilesImpl, listSessionDirectoryImpl } from '@mobi/node-core/handlers/sessionFiles'
import { gitReviewRpcImpl } from '@mobi/node-core/handlers/gitReview'
import { getWebToolsConfigImpl, setWebToolsConfigImpl, verifyWebToolsProviderImpl } from '@mobi/node-core/handlers/webToolsConfig'
import { refreshMetadataImpl } from '@mobi/node-core/handlers/commands'
import type { MachineHost, RpcGetWebToolsConfigResponse, RpcListDirectoryResponse, RpcRefreshMetadataResponse, SpawnSessionOptions } from './MachineHost'

export class LocalMachineHost implements MachineHost {
    /** 未切换方法组的 socket 兜底（逐组退场） */
    private readonly fallback: MachineHost

    constructor(fallback: MachineHost) {
        this.fallback = fallback
    }

    async spawnSession(machineId: string, directory: string, options?: SpawnSessionOptions) {
        return await this.fallback.spawnSession(machineId, directory, options)
    }

    // ── 文件读组（ticket-17 组1：本地直调，不经 socket loopback）──

    async checkPathsExist(_machineId: string, paths: string[]) {
        const result = await checkPathsExistImpl({ paths })
        // socket 版对回执做布尔归一（信任边界），本地直调结果同样归一保持同构
        const exists: Record<string, boolean> = {}
        for (const [key, value] of Object.entries(result.exists)) {
            exists[key] = value === true
        }
        return exists
    }

    async machineReadFileMeta(_machineId: string, cwd: string, path: string) {
        return await machineReadFileMetaImpl({ cwd, path }, homedir())
    }

    async machineReadFileRange(_machineId: string, cwd: string, path: string, offset: number, length: number) {
        return await machineReadFileRangeImpl({ cwd, path, offset, length }, homedir())
    }

    // ── git 审查族（ticket-17 组4：本地直调，方法表查表单源）──

    async machineGitReviewOverview(_machineId: string, cwd: string, sessionId: string) {
        return await gitReviewRpcImpl(GIT_REVIEW_RPC.overview, { cwd, sessionId }) as ReviewOverview | { success: false; error: string }
    }

    async machineGitReviewFiles(_machineId: string, cwd: string, sessionId: string, target: DiffTarget) {
        return await gitReviewRpcImpl(GIT_REVIEW_RPC.files, { cwd, sessionId, target }) as ReviewFilesResult | { success: false; error: string }
    }

    async machineGitReviewDiff(_machineId: string, cwd: string, sessionId: string, target: DiffTarget, path: string) {
        return await gitReviewRpcImpl(GIT_REVIEW_RPC.diff, { cwd, sessionId, target, path }) as ReviewPatchResult | { success: false; error: string }
    }

    async machineGitReviewContents(_machineId: string, cwd: string, sessionId: string, target: DiffTarget, path: string) {
        return await gitReviewRpcImpl(GIT_REVIEW_RPC.contents, { cwd, sessionId, target, path }) as ReviewContentsResult | { success: false; error: string }
    }

    async machineGitReviewCommits(_machineId: string, cwd: string, cursor?: string) {
        return await gitReviewRpcImpl(GIT_REVIEW_RPC.commits, { cwd, cursor }) as ReviewCommitsResult | { success: false; error: string }
    }

    async machineGitReviewInit(_machineId: string, cwd: string) {
        return await gitReviewRpcImpl(GIT_REVIEW_RPC.init, { cwd }) as ReviewActionResult
    }

    async clearTurnSnapshots(_machineId: string, cwd: string, sessionId: string) {
        await gitReviewRpcImpl(GIT_REVIEW_RPC.clear, { cwd, sessionId })
    }

    // ── 写/上传组（ticket-17 组2：本地直调）──
    // 回退 workingDirectory 仅在 cwd 缺省时生效；MachineHost 四方法恒注入 cwd，回退不参与语义
    async machineSaveFile(_machineId: string, cwd: string, path: string, content: Uint8Array, baseEtag: string) {
        return await saveFileImpl({ cwd, path, content, baseEtag }, homedir(), homedir())
    }

    // ── 目录与搜索组（ticket-17 组3：本地直调）──

    // 条目形状（仅 name）比 RpcListDirectoryEntry 窄——与 SocketMachineHost 同款 as 断言透传
    async listMachineDirectory(_machineId: string, path: string, homeDir: string): Promise<RpcListDirectoryResponse> {
        return await listMachineDirectoryImpl({ path, homeDir }) as RpcListDirectoryResponse
    }

    async machineUploadFileRange(
        _machineId: string,
        cwd: string,
        filename: string,
        path: string | undefined,
        offset: number,
        content: Uint8Array,
        totalSize?: number,
    ) {
        return await writeFileRangeImpl({ cwd, filename, path, offset, content, totalSize }, homedir())
    }

    async machineDeleteUpload(_machineId: string, cwd: string, path: string) {
        return await deleteUploadImpl({ cwd, path }, homedir())
    }

    async machineReplaceUpload(_machineId: string, cwd: string, path: string, content: Uint8Array) {
        return await replaceUploadImpl({ cwd, path, content }, homedir())
    }

    // ── web-tools + metadata 组（ticket-17 组5：本地直调）──

    // error envelope 形状比 MachineHost 响应类型宽——与 SocketMachineHost 同款 as 断言透传
    async getWebToolsConfig(_machineId: string): Promise<RpcGetWebToolsConfigResponse> {
        return await getWebToolsConfigImpl() as RpcGetWebToolsConfigResponse
    }

    async setWebToolsConfig(_machineId: string, config: unknown) {
        return await setWebToolsConfigImpl({ config })
    }

    async verifyWebToolsProvider(_machineId: string, providerId: string, credentials?: Record<string, string>) {
        return await verifyWebToolsProviderImpl({ providerId: providerId as never, credentials })
    }

    async machineSearchFiles(_machineId: string, cwd: string, query: string, type?: 'file' | 'directory') {
        return await searchSessionFilesImpl({ cwd, query, type }, homedir())
    }

    async machineListSessionDirectory(_machineId: string, cwd: string, path: string, prefix?: string) {
        return await listSessionDirectoryImpl({ cwd, path, prefix }, homedir())
    }

    async machineRefreshMetadata(_machineId: string, cwd: string): Promise<RpcRefreshMetadataResponse> {
        return await refreshMetadataImpl({ cwd }) as RpcRefreshMetadataResponse
    }
}
