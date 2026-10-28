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
 * SDK Metadata Extractor
 * 使用官方 SDK 的 initializationResult() 方法获取可用工具和命令
 *
 * 这是**无会话**时的探针（新会话页按 cwd 取能力面、本地会话启动兜底）。
 * 活跃会话应优先使用 `capabilityCatalog.readLiveCapabilities` 问自己的 Query，
 * 不要在这里再起一个进程。
 */

import { existsSync } from 'fs'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { logger } from '@mobi/node-core/logger'
import { configuration } from '@mobi/node-core/configuration'
import { getClaudeExecutablePath } from './claudeExecutable'
import { stripBunDebuggerEnv } from '@mobi/node-core/utils/spawnMobiCli'
import { buildBundledPluginOptions } from '@mobi/node-core/runtime/bundledPlugins'
import type { SDKMetadata } from '@mobi/shared'

// 重新导出类型供其他模块使用
export type {
    SDKMetadata,
    SlashCommand,
    AgentInfo,
    ModelInfo,
    AccountInfo,
    FastModeState
} from '@mobi/shared'

/** 探针超时（对齐 Claude Desktop `TEMP_QUERY_TIMEOUT_MS`） */
export const PROBE_TIMEOUT_MS = 90_000
/** 同时存活的探针上限（对齐 Claude Desktop `TEMP_QUERY_CONCURRENCY`） */
export const MAX_CONCURRENT_PROBES = 2

/** 探针失败分类：超时不重试，空结果不再冒充成功 */
export class CapabilityProbeError extends Error {
    constructor(readonly code: 'timeout' | 'empty', message: string) {
        super(message)
        this.name = 'CapabilityProbeError'
    }
}

// —— 并发闸：所有探针入口共用（含本地会话启动的 extractSDKMetadataAsync） ——
let activeProbes = 0
const probeWaiters: Array<() => void> = []

async function acquireProbeSlot(): Promise<() => void> {
    while (activeProbes >= MAX_CONCURRENT_PROBES) {
        await new Promise<void>((resolve) => probeWaiters.push(resolve))
    }
    activeProbes += 1
    let released = false
    return () => {
        if (released) return
        released = true
        activeProbes -= 1
        probeWaiters.shift()?.()
    }
}

/** initializationResult 的能力面字段（CLI 侧 snake_case） */
interface InitCapabilityResponse {
    commands?: SDKMetadata['commands']
    agents?: SDKMetadata['agents']
    models?: SDKMetadata['models']
    output_style?: string
    available_output_styles?: string[]
    account?: SDKMetadata['account']
    fast_mode_state?: SDKMetadata['fastModeState']
    /** 协议能力名（开放字符串集合，web feature-detect 用；CLI 2.1.312+ 广播——
     *  注意 SDK 通道为收窄集合，2026-10-28 E2E 实锤，见 shared SDKMetadataSchema 注释） */
    capabilities?: string[]
}

/** 空结果守卫：三件套全空说明发现不可信，不能当有效数据返回 */
function hasCapabilities(init: InitCapabilityResponse): boolean {
    return (init.commands?.length ?? 0) + (init.agents?.length ?? 0) + (init.models?.length ?? 0) > 0
}

function projectInit(init: InitCapabilityResponse): SDKMetadata {
    return {
        commands: init.commands,
        agents: init.agents,
        outputStyle: init.output_style,
        availableOutputStyles: init.available_output_styles,
        models: init.models,
        account: init.account,
        fastModeState: init.fast_mode_state,
        capabilities: init.capabilities,
    }
}

/** 空 async iterable：子进程启动并初始化，但永远不触发模型调用 */
function emptyPrompt(): AsyncIterable<never> {
    return {
        [Symbol.asyncIterator]() {
            return { next: () => new Promise<never>(() => {}) }
        },
    }
}

/**
 * 单次探测。`withPlugins=false` 用于插件导致的失败降级重试。
 * 超时以 `CapabilityProbeError('timeout')` 抛出；空结果抛 `'empty'`。
 */
async function runProbe(cwd: string | undefined, withPlugins: boolean): Promise<SDKMetadata> {
    const abortController = new AbortController()
    let sdkQuery: ReturnType<typeof query> | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    let timedOut = false

    try {
        // 清理 IDE 调试器环境变量，避免子进程继承后绑定同一 socket 导致启动失败
        const childEnv = { ...process.env } as Record<string, string | undefined>
        stripBunDebuggerEnv(childEnv)

        // dev 模式返回 undefined，由 SDK 自动 require.resolve
        const claudeExecutable = await getClaudeExecutablePath()
        const options: Parameters<typeof query>[0]['options'] = {
            abortController,
            pathToClaudeCodeExecutable: claudeExecutable,
            persistSession: false,
            env: childEnv,
            // 探针只读配置，不执行任何东西：默认权限 + 全拒工具 + 禁用户 hooks。
            // settingSources 保持默认——mobi 没有 workspace trust 流程，收窄会静默丢项目命令。
            permissionMode: 'default',
            canUseTool: async () => ({ behavior: 'deny' as const, message: 'Config loading only' }),
            settings: { disableAllHooks: true },
        }

        // 传入 cwd 以支持项目级命令和 skills 发现
        // 目录不存在时 fallback 到 mobi 配置目录，获取全局默认 metadata（不含项目级配置）
        if (cwd && existsSync(cwd)) {
            options.cwd = cwd
        } else if (cwd) {
            logger.debug('[capability] cwd does not exist, falling back to mobiHomeDir:', cwd)
            options.cwd = configuration.mobiHomeDir
        }

        // 内置插件与真实会话同源挂载（local 模式的 `/` 面板命令以此探针为唯一来源，
        // 不带 plugins 会让插件 skill 从命令面板消失——2026-09-26 visualize 实测缺失）
        if (withPlugins) {
            options.plugins = buildBundledPluginOptions()
        }

        sdkQuery = query({ prompt: emptyPrompt(), options })
        // 超时用 race 兜底：abort 只负责杀子进程，SDK 不保证一定以拒绝响应
        const timeout = new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
                timedOut = true
                abortController.abort()
                reject(new CapabilityProbeError('timeout', `probe timed out after ${PROBE_TIMEOUT_MS}ms`))
            }, PROBE_TIMEOUT_MS)
        })

        const init = ((await Promise.race([sdkQuery.initializationResult(), timeout])) ?? {}) as InitCapabilityResponse
        if (!hasCapabilities(init)) {
            throw new CapabilityProbeError('empty', 'probe returned no commands, agents or models')
        }
        return projectInit(init)
    } catch (error) {
        if (timedOut) {
            throw new CapabilityProbeError('timeout', `probe timed out after ${PROBE_TIMEOUT_MS}ms`)
        }
        throw error
    } finally {
        if (timer) clearTimeout(timer)
        try {
            sdkQuery?.close()
        } catch {
            // 已关闭 / 进程已退出
        }
    }
}

/**
 * 使用官方 SDK 的 initializationResult() 方法提取元数据
 *
 * 通过空 AsyncIterable 作为 prompt，子进程完成初始化后等待消息但不触发 API 调用，
 * 此时 initializationResult() 已可用。拿到后立即 close()，零 token 消耗。
 *
 * 失败一律抛错（不再返回空对象）：空结果会被上层当作有效数据写库/缓存。
 *
 * @param cwd 可选的工作目录，传入后可获取项目级别的 .claude/commands 和 skills
 */
export async function extractSDKMetadata(cwd?: string): Promise<SDKMetadata> {
    const release = await acquireProbeSlot()
    const startedAt = Date.now()
    logger.debug('[capability] probe start', { cwd })
    try {
        try {
            const metadata = await runProbe(cwd, true)
            logger.debug('[capability] probe-ok', { cwd, ms: Date.now() - startedAt })
            return metadata
        } catch (error) {
            // 超时/空结果不重试：前者再等 90s 只会拖更久，后者去掉插件也变不出 builtin
            if (error instanceof CapabilityProbeError) throw error
            if (buildBundledPluginOptions().length === 0) throw error
            logger.debug('[capability] probe retry without plugins', { cwd, error: String(error) })
            const metadata = await runProbe(cwd, false)
            logger.debug('[capability] probe-ok', { cwd, ms: Date.now() - startedAt, retried: true })
            return metadata
        }
    } catch (error) {
        logger.debug('[capability] probe-fail', {
            cwd,
            ms: Date.now() - startedAt,
            code: error instanceof CapabilityProbeError ? error.code : 'error',
            error: String(error),
        })
        throw error
    } finally {
        release()
    }
}

/**
 * 异步提取 SDK 元数据，完成后回调通知
 *
 * 仅本地会话启动时使用（没有活 Query）。失败静默。
 *
 * @param onComplete 元数据就绪后的回调
 * @param cwd 可选的工作目录，传入后可获取项目级别的 .claude/commands 和 skills
 */
export function extractSDKMetadataAsync(onComplete: (metadata: SDKMetadata) => void, cwd?: string): void {
    extractSDKMetadata(cwd)
        .then(metadata => {
            if (metadata.agents || metadata.commands) {
                onComplete(metadata)
            }
        })
        .catch(error => {
            logger.debug('[capability] async probe failed:', error)
        })
}
