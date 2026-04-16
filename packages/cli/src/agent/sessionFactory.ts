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

import { ApiClient } from '@/api/api'
import type { ApiSessionClient } from '@/api/apiSession'
import type { AgentState, MachineMetadata, Metadata, Session } from '@/api/types'
import { notifyRunnerSessionStarted } from '@/runner/controlClient'
import { readSettings } from '@/persistence'
import { configuration } from '@/configuration'
import { logger } from '@/ui/logger'
import { runtimePath } from '@/projectPath'
import { readWorktreeEnv } from '@/utils/worktreeEnv'
import packageJson from '../../package.json'

export type SessionStartedBy = 'runner' | 'terminal'

export type SessionBootstrapOptions = {
    flavor: string
    startedBy?: SessionStartedBy
    workingDirectory?: string
    tag?: string
    agentState?: AgentState | null
    model?: string
    claudeArgs?: string[]   // 用于解析 --resume，从而复用已有 Hub session
}

export type SessionBootstrapResult = {
    api: ApiClient
    apiSession: ApiSessionClient
    sessionInfo: Session
    metadata: Metadata
    machineId: string
    startedBy: SessionStartedBy
    workingDirectory: string
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
        worktree: worktreeInfo ?? undefined
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
        state: agentState
    })

    const apiSession = api.sessionSyncClient(sessionInfo)

    // 通知 runner session 已启动
    await reportSessionStarted(sessionInfo.id, metadata)

    return {
        api,
        apiSession,
        sessionInfo,
        metadata,
        machineId,
        startedBy,
        workingDirectory
    }
}
