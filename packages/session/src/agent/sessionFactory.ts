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

import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { access } from 'node:fs/promises'

import { ApiClient } from '@mobi/node-core/api/api'
import { ApiSessionClient } from '../api/apiSession'
import type { AgentState, Metadata, Workspace, Session } from '@mobi/node-core/api/types'
import type { EffortLevel } from '@mobi/shared'
import { notifyRunnerSessionStarted } from './sessionWebhook'
import { configuration } from '@mobi/node-core/configuration'
import { logger } from '@mobi/node-core/logger'
import { runtimePath } from '@mobi/node-core/projectPath'
import { readWorktreeEnv, readGitBranch } from '@mobi/node-core/utils/worktreeEnv'
import packageJson from '../../package.json'

export type SessionStartedBy = 'runner' | 'terminal'

export type SessionBootstrapOptions = {
    flavor: string
    startedBy?: SessionStartedBy
    workingDirectory?: string
    tag?: string
    agentState?: AgentState | null
    model?: string
    effort?: EffortLevel
    claudeArgs?: string[]   // 用于解析 --resume，从而复用已有 Hub session
    startingMode?: 'local' | 'remote'
    /** 归属工作区（Web spawn 透传；缺省 = 游离） */
    workspaceId?: string
}

export type SessionBootstrapResult = {
    api: ApiClient
    apiSession: ApiSessionClient
    sessionInfo: Session
    metadata: Metadata
    startedBy: SessionStartedBy
    workingDirectory: string
    /** 创建时冻结 / resume 回放的额外工作目录（已过滤不存在路径） */
    additionalDirectories: string[]
}

export function buildSessionMetadata(options: {
    flavor: string
    startedBy: SessionStartedBy
    workingDirectory: string
    now?: number
}): Metadata {
    const mobiLibDir = runtimePath()
    const worktreeInfo = readWorktreeEnv()
    const gitBranch = readGitBranch(options.workingDirectory)
    const now = options.now ?? Date.now()

    return {
        path: options.workingDirectory,
        host: os.hostname(),
        version: packageJson.version,
        os: os.platform(),
        homeDir: os.homedir(),
        mobiHomeDir: configuration.mobiHomeDir,
        mobiLibDir,
        mobiToolsDir: resolve(mobiLibDir, 'tools', 'unpacked'),
        startedFromRunner: options.startedBy === 'runner',
        hostPid: process.pid,
        startedBy: options.startedBy,
        lifecycleState: 'running',
        lifecycleStateSince: now,
        flavor: options.flavor,
        worktree: worktreeInfo ?? undefined,
        gitBranch: gitBranch ?? undefined,
    }
}

async function reportSessionStarted(sessionId: string, metadata: Metadata): Promise<void> {
    try {
        logger.debug(`[START] Reporting session ${sessionId} to runner`)
        const result = await notifyRunnerSessionStarted(sessionId, metadata)
        if (result?.error) {
            logger.debug(`[START] Failed to report to runner (may not be running):`, result.error)
        } else {
            logger.debug(`[START] Reported session ${sessionId} to runner`)
        }
    } catch (error) {
        logger.debug('[START] Failed to report to runner (may not be running):', error)
    }
}

/**
 * 从 claudeArgs 中解析 --resume 的 session ID
 * 例：['--resume', 'abc-123'] → 'abc-123'
 * 例：['--resume'] → null（无参数，恢复上次会话，没有显式 ID）
 * 例：undefined / 无 --resume → null
 */
function extractResumeSessionId(claudeArgs?: string[]): string | null {
    if (!claudeArgs) return null
    const idx = claudeArgs.findIndex(arg => arg === '--resume' || arg === '-r')
    if (idx === -1) return null
    const next = claudeArgs[idx + 1]
    // 下一个参数存在且不是 flag（不以 - 开头），视为 session ID
    if (next && !next.startsWith('-')) {
        return next
    }
    return null
}

/**
 * 计算会话的额外工作目录，优先级：冻结列表 > 工作区派生 > 空。
 * 返回 { dirs, freeze }：freeze 表示派生结果（含空列表）是否应写入 metadata 冻结。
 * 1. metadata.additionalDirectories 键已冻结（创建/迁移时写入，含空列表）→ 直接回放，
 *    完全忽略响应中的 workspace（不读 folders）——resume 历史会话不受
 *    工作区后续变更影响，且不重写（freeze=false）
 * 2. 无该键 → 从 workspace.folders 派生（freeze=true）：
 *    - 存在性校验：解析后等于 cwd 的文件夹跳过（agent 本就在里面），其余（含 primary）
 *      逐个校验并加入；primary 非 cwd 且缺失硬失败，其余缺失 warn 跳过
 *    - （machineId 归属门禁已随 machine 概念移除退场——单机世界工作区恒属本机）
 * 3. 都无 → 空数组（freeze=false）
 */
async function resolveAdditionalDirectories(input: {
    workspace: Workspace | null
    sessionMetadata: unknown
    workingDirectory: string
}): Promise<{ dirs: string[]; freeze: boolean }> {
    const { workspace, sessionMetadata, workingDirectory } = input

    // 优先级 1：冻结列表回放（键存在即冻结，空列表同样冻结——单文件夹工作区冻结 []，
    // resume 不再重读工作区）。hub 对已绑工作区的会话始终返回 workspace，但冻结后工作区
    // folders 的任何变更都不应影响历史会话，故此处不看 workspace
    const frozen = readFrozenAdditionalDirectories(sessionMetadata)
    if (frozen) {
        return { dirs: frozen, freeze: false }
    }

    // 优先级 2：工作区派生（新建 / 迁移存量首次 resume）
    if (workspace) {
        const cwd = resolve(workingDirectory)
        const dirs: string[] = []
        for (const folder of workspace.folders) {
            // 等于 cwd 的文件夹跳过（agent 本就以它为工作目录）；解析路径而非前缀匹配，
            // 避免 /a/mobic 误配 /a/mobi。worktree/子目录启动时 primary≠cwd → 会被加入
            if (resolve(folder.path) === cwd) {
                continue
            }
            const exists = await access(folder.path).then(() => true).catch(() => false)
            if (!exists) {
                if (folder.primary) {
                    // primary 既不是 cwd 又不存在 → 工作区主目录失效，硬失败
                    throw new Error(`Primary folder does not exist: ${folder.path}`)
                }
                logger.warn(`[START] 工作区文件夹不存在，跳过 add-dir: ${folder.path}`)
                continue
            }
            dirs.push(folder.path)
        }
        return { dirs, freeze: true }
    }

    // 优先级 3：游离 / resume 未绑工作区且无冻结 → 空
    return { dirs: [], freeze: false }
}

/** metadata 中是否已冻结 additionalDirectories（按键存在判定；返回 null = 未冻结） */
function readFrozenAdditionalDirectories(sessionMetadata: unknown): string[] | null {
    const frozen = (sessionMetadata as { additionalDirectories?: unknown } | null)?.additionalDirectories
    return Array.isArray(frozen) ? frozen : null
}

export async function bootstrapSession(options: SessionBootstrapOptions): Promise<SessionBootstrapResult> {
    const workingDirectory = options.workingDirectory ?? process.cwd()
    const startedBy = options.startedBy ?? 'terminal'
    const agentState = options.agentState === undefined ? {} : options.agentState

    // 与 hub 通信的 API 客户端
    const api = await ApiClient.create()

    let sessionTag = options.tag ?? randomUUID()

    // 若有 --resume <nativeSessionId>，尝试找到已有 Hub session 并复用其 tag
    const resumeClaudeSessionId = extractResumeSessionId(options.claudeArgs)
    if (resumeClaudeSessionId) {
        logger.debug(`[START] --resume 检测到 nativeSessionId: ${resumeClaudeSessionId}，尝试复用 Hub session`)
        try {
            const existingSession = await api.getSessionByClaudeSessionId(resumeClaudeSessionId)
            if (existingSession?.tag) {
                if (existingSession.active) {
                    // 该 Claude 会话仍有一个 mobi 进程在跑（如另一终端还挂着）：
                    // 复用 tag 会让两个进程并到同一条 Hub session，消息流交错、
                    // runtimeState 互相覆盖。对齐 Web 端「active 的 session 不可再
                    // 接入」语义——降级为新建 session；Claude 层照旧 resume
                    // （与用户裸跑两个 claude -c 同水平，mobi 不拦）
                    logger.debug(`[START] 已有 Hub session (id=${existingSession.id}) 仍在运行，不复用 tag，新建 session`)
                } else {
                    // 用已有 session 的 tag 调用 getOrCreateSession，Hub 会返回同一条记录
                    sessionTag = existingSession.tag
                    logger.debug(`[START] 找到已有 Hub session (id=${existingSession.id})，复用 tag: ${sessionTag}`)
                }
            } else {
                logger.debug(`[START] 未找到对应 Hub session，新建`)
            }
        } catch (error) {
            logger.debug(`[START] 查找 Hub session 失败，降级为新建:`, error)
        }
    }

    const metadata = buildSessionMetadata({
        flavor: options.flavor,
        startedBy,
        workingDirectory
    })

    // 创建或复用 session
    const sessionInfo = await api.getOrCreateSession({
        tag: sessionTag,
        metadata,
        state: agentState,
        mode: options.startingMode,
        runtimeState: options.effort ? { effort: options.effort } : undefined,
        workspaceId: options.workspaceId
    })

    const apiSession = ApiSessionClient.create(api.token, sessionInfo)

    // 解析额外工作目录：优先回放冻结列表，其次从工作区 folders 派生（见函数 docstring 的优先级规则）
    const { dirs: additionalDirectories, freeze } = await resolveAdditionalDirectories({
        workspace: sessionInfo.workspace,
        sessionMetadata: sessionInfo.metadata,
        workingDirectory
    })

    // 派生结果冻结（含空列表——单文件夹工作区冻结 []，resume 不再重读工作区）：
    // 仅派生路径（freeze=true）写入；回放路径不写，保证冻结列表稳定、
    // 不被工作区后续变更追溯覆盖
    if (freeze) {
        apiSession.updateMetadata((current) => ({
            ...current,
            additionalDirectories
        }))
    }

    // 通知 runner session 已启动
    await reportSessionStarted(sessionInfo.id, metadata)

    return {
        api,
        apiSession,
        sessionInfo,
        metadata,
        startedBy,
        workingDirectory,
        additionalDirectories
    }
}
