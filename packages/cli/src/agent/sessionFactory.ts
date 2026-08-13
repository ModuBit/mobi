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

import { ApiClient } from '@/api/api'
import type { ApiSessionClient } from '@/api/apiSession'
import type { AgentState, MachineMetadata, Metadata, Project, Session } from '@/api/types'
import type { EffortLevel } from '@mobi/shared'
import { notifyRunnerSessionStarted } from '@/runner/controlClient'
import { readSettings } from '@/persistence'
import { configuration } from '@/configuration'
import { logger } from '@/ui/logger'
import { runtimePath } from '@/projectPath'
import { readWorktreeEnv, readGitBranch } from '@/utils/worktreeEnv'
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
    /** 归属项目（Web spawn 透传；缺省 = 游离） */
    projectId?: string
}

export type SessionBootstrapResult = {
    api: ApiClient
    apiSession: ApiSessionClient
    sessionInfo: Session
    metadata: Metadata
    machineId: string
    startedBy: SessionStartedBy
    workingDirectory: string
    /** 创建时冻结 / resume 回放的额外工作目录（已过滤不存在路径） */
    additionalDirectories: string[]
}

export function buildMachineMetadata(): MachineMetadata {
    return {
        host: process.env.MOBI_HOSTNAME || os.hostname(),
        platform: os.platform(),
        mobiCliVersion: packageJson.version,
        homeDir: os.homedir(),
        mobiHomeDir: configuration.mobiHomeDir,
        mobiLibDir: runtimePath()
    }
}

export function buildSessionMetadata(options: {
    flavor: string
    startedBy: SessionStartedBy
    workingDirectory: string
    machineId: string
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
        machineId: options.machineId,
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

async function getMachineIdOrExit(): Promise<string> {
    const settings = await readSettings()
    const machineId = settings?.machineId
    if (!machineId) {
        console.error(`[START] No machine ID found in settings, which is unexpected since authAndSetupMachineIfNeeded should have created it. Please report this issue on ${packageJson.bugs}`)
        process.exit(1)
    }
    logger.debug(`Using machineId: ${machineId}`)
    return machineId
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
 * 计算会话的额外工作目录，优先级：冻结列表 > 项目派生 > 空。
 * 返回 { dirs, freeze }：freeze 表示派生结果（含空列表）是否应写入 metadata 冻结。
 * 1. metadata.additionalDirectories 键已冻结（创建/迁移时写入，含空列表）→ 直接回放，
 *    完全忽略响应中的 project（不校验 machineId、不读 folders）——resume 历史会话不受
 *    项目后续变更影响，且不重写（freeze=false）
 * 2. 无该键 → 从 project.folders 派生（freeze=true）：
 *    - 显式 --project（explicitProject）时 machineId 必须匹配，不匹配硬失败——用户明确
 *      指定了归属，错了要立刻暴露
 *    - 非显式（resume 历史会话，含迁移存量首次 resume）时 machineId 不匹配降级为
 *      warn + 空目录且不冻结（freeze=false）——迁移前可恢复的会话不能因机器门禁起不来，
 *      留待在正确机器上 resume 时再派生
 *    - 存在性校验：解析后等于 cwd 的文件夹跳过（agent 本就在里面），其余（含 primary）
 *      逐个校验并加入；primary 非 cwd 且缺失硬失败，其余缺失 warn 跳过
 * 3. 都无 → 空数组（freeze=false）
 */
async function resolveAdditionalDirectories(input: {
    project: Project | null
    sessionMetadata: unknown
    machineId: string
    workingDirectory: string
    /** projectId 是否由用户显式指定（--project / Web spawn）——决定机器门禁是硬失败还是降级 */
    explicitProject: boolean
}): Promise<{ dirs: string[]; freeze: boolean }> {
    const { project, sessionMetadata, machineId, workingDirectory, explicitProject } = input

    // 优先级 1：冻结列表回放（键存在即冻结，空列表同样冻结——单文件夹项目冻结 []，
    // resume 不再重读项目）。hub 对已绑项目的会话始终返回 project，但冻结后项目
    // folders 的任何变更都不应影响历史会话，故此处不看 project
    const frozen = readFrozenAdditionalDirectories(sessionMetadata)
    if (frozen) {
        return { dirs: frozen, freeze: false }
    }

    // 优先级 2：项目派生（新建 / 迁移存量首次 resume）
    if (project) {
        // folders 是机器本地路径，项目必须归属本机才能使用
        if (project.machineId !== machineId) {
            if (explicitProject) {
                throw new Error(`Project '${project.name}' belongs to a different machine (${project.machineId}), this machine is ${machineId}`)
            }
            // resume 历史会话（如迁移兜底 'unknown' 或众数机器 ≠ 当前机器）：
            // 机器门禁只约束显式归属，不阻断历史会话恢复——降级为无额外目录，且不冻结，
            // 留待在正确机器上 resume 时再派生
            logger.warn(
                `[START] 会话所属项目 '${project.name}' 归属其他机器（${project.machineId}，本机 ${machineId}），跳过项目目录注入`
            )
            return { dirs: [], freeze: false }
        }

        const cwd = resolve(workingDirectory)
        const dirs: string[] = []
        for (const folder of project.folders) {
            // 等于 cwd 的文件夹跳过（agent 本就以它为工作目录）；解析路径而非前缀匹配，
            // 避免 /a/mobic 误配 /a/mobi。worktree/子目录启动时 primary≠cwd → 会被加入
            if (resolve(folder.path) === cwd) {
                continue
            }
            const exists = await access(folder.path).then(() => true).catch(() => false)
            if (!exists) {
                if (folder.primary) {
                    // primary 既不是 cwd 又不存在 → 项目主目录失效，硬失败
                    throw new Error(`Primary folder does not exist: ${folder.path}`)
                }
                logger.warn(`[START] 项目文件夹不存在，跳过 add-dir: ${folder.path}`)
                continue
            }
            dirs.push(folder.path)
        }
        return { dirs, freeze: true }
    }

    // 优先级 3：游离 / resume 未绑项目且无冻结 → 空
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

    // 若有 --resume <claudeSessionId>，尝试找到已有 Hub session 并复用其 tag
    const resumeClaudeSessionId = extractResumeSessionId(options.claudeArgs)
    if (resumeClaudeSessionId) {
        logger.debug(`[START] --resume 检测到 claudeSessionId: ${resumeClaudeSessionId}，尝试复用 Hub session`)
        try {
            const existingSession = await api.getSessionByClaudeSessionId(resumeClaudeSessionId)
            if (existingSession?.tag) {
                // 用已有 session 的 tag 调用 getOrCreateSession，Hub 会返回同一条记录
                sessionTag = existingSession.tag
                logger.debug(`[START] 找到已有 Hub session (id=${existingSession.id})，复用 tag: ${sessionTag}`)
            } else {
                logger.debug(`[START] 未找到对应 Hub session，新建`)
            }
        } catch (error) {
            logger.debug(`[START] 查找 Hub session 失败，降级为新建:`, error)
        }
    }

    // 注册 machine
    const machineId = await getMachineIdOrExit()
    await api.getOrCreateMachine({
        machineId,
        metadata: buildMachineMetadata()
    })

    const metadata = buildSessionMetadata({
        flavor: options.flavor,
        startedBy,
        workingDirectory,
        machineId
    })

    // 创建或复用 session
    const sessionInfo = await api.getOrCreateSession({
        tag: sessionTag,
        metadata,
        state: agentState,
        mode: options.startingMode,
        runtimeState: options.effort ? { effort: options.effort } : undefined,
        projectId: options.projectId
    })

    const apiSession = api.sessionSyncClient(sessionInfo)

    // 解析额外工作目录：优先回放冻结列表，其次从项目 folders 派生（见函数 docstring 的优先级规则）
    const { dirs: additionalDirectories, freeze } = await resolveAdditionalDirectories({
        project: sessionInfo.project,
        sessionMetadata: sessionInfo.metadata,
        machineId,
        workingDirectory,
        explicitProject: options.projectId !== undefined
    })

    // 派生结果冻结（含空列表——单文件夹项目冻结 []，resume 不再重读项目）：
    // 仅派生路径（freeze=true）写入；回放路径与机器不匹配降级路径不写，
    // 保证冻结列表稳定、不被项目后续变更追溯覆盖
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
        machineId,
        startedBy,
        workingDirectory,
        additionalDirectories
    }
}
