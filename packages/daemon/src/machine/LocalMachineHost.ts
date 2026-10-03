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
import type { DiffTarget } from '@mobi/shared'
import { checkPathsExistImpl } from '@mobi/node-core/handlers/pathExists'
import { machineReadFileMetaImpl, machineReadFileRangeImpl } from '@mobi/node-core/handlers/machineFiles'
import type { MachineHost, SpawnSessionOptions } from './MachineHost'

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

    async machineGitReviewOverview(machineId: string, cwd: string, sessionId: string) {
        return await this.fallback.machineGitReviewOverview(machineId, cwd, sessionId)
    }

    async machineGitReviewFiles(machineId: string, cwd: string, sessionId: string, target: DiffTarget) {
        return await this.fallback.machineGitReviewFiles(machineId, cwd, sessionId, target)
    }

    async machineGitReviewDiff(machineId: string, cwd: string, sessionId: string, target: DiffTarget, path: string) {
        return await this.fallback.machineGitReviewDiff(machineId, cwd, sessionId, target, path)
    }

    async machineGitReviewContents(machineId: string, cwd: string, sessionId: string, target: DiffTarget, path: string) {
        return await this.fallback.machineGitReviewContents(machineId, cwd, sessionId, target, path)
    }

    async machineGitReviewCommits(machineId: string, cwd: string, cursor?: string) {
        return await this.fallback.machineGitReviewCommits(machineId, cwd, cursor)
    }

    async machineGitReviewInit(machineId: string, cwd: string) {
        return await this.fallback.machineGitReviewInit(machineId, cwd)
    }

    async clearTurnSnapshots(machineId: string, cwd: string, sessionId: string) {
        await this.fallback.clearTurnSnapshots(machineId, cwd, sessionId)
    }

    async machineSaveFile(machineId: string, cwd: string, path: string, content: Uint8Array, baseEtag: string) {
        return await this.fallback.machineSaveFile(machineId, cwd, path, content, baseEtag)
    }

    async listMachineDirectory(machineId: string, path: string, homeDir: string) {
        return await this.fallback.listMachineDirectory(machineId, path, homeDir)
    }

    async machineUploadFileRange(
        machineId: string,
        cwd: string,
        filename: string,
        path: string | undefined,
        offset: number,
        content: Uint8Array,
        totalSize?: number,
    ) {
        return await this.fallback.machineUploadFileRange(machineId, cwd, filename, path, offset, content, totalSize)
    }

    async machineDeleteUpload(machineId: string, cwd: string, path: string) {
        return await this.fallback.machineDeleteUpload(machineId, cwd, path)
    }

    async machineReplaceUpload(machineId: string, cwd: string, path: string, content: Uint8Array) {
        return await this.fallback.machineReplaceUpload(machineId, cwd, path, content)
    }

    async getWebToolsConfig(machineId: string) {
        return await this.fallback.getWebToolsConfig(machineId)
    }

    async setWebToolsConfig(machineId: string, config: unknown) {
        return await this.fallback.setWebToolsConfig(machineId, config)
    }

    async verifyWebToolsProvider(machineId: string, providerId: string, credentials?: Record<string, string>) {
        return await this.fallback.verifyWebToolsProvider(machineId, providerId, credentials)
    }

    async machineSearchFiles(machineId: string, cwd: string, query: string, type?: 'file' | 'directory') {
        return await this.fallback.machineSearchFiles(machineId, cwd, query, type)
    }

    async machineListSessionDirectory(machineId: string, cwd: string, path: string, prefix?: string) {
        return await this.fallback.machineListSessionDirectory(machineId, cwd, path, prefix)
    }

    async machineRefreshMetadata(machineId: string, cwd: string) {
        return await this.fallback.machineRefreshMetadata(machineId, cwd)
    }
}
