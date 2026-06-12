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
 */

import { existsSync } from 'fs'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { logger } from '@/ui/logger'
import { configuration } from '@/configuration'
import { getDefaultClaudeCodePath } from '@/claude/sdk/utils'
import { stripBunDebuggerEnv } from '@/utils/spawnMobiCli'
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

/**
 * 使用官方 SDK 的 initializationResult() 方法提取元数据
 *
 * 通过空 AsyncIterable 作为 prompt，子进程完成初始化后等待消息但不触发 API 调用，
 * 此时 initializationResult() 已可用。拿到后立即 close()，零 token 消耗。
 *
 * @param cwd 可选的工作目录，传入后可获取项目级别的 .claude/commands 和 skills
 * @returns SDK 元数据，包含完整的初始化响应信息
 */
export async function extractSDKMetadata(cwd?: string): Promise<SDKMetadata> {
    const abortController = new AbortController()

    try {
        logger.debug('[metadataExtractor] Starting SDK metadata extraction')

        // 空 async iterable：子进程启动并初始化，但永远不触发模型调用
        const emptyPrompt: AsyncIterable<never> = {
            [Symbol.asyncIterator]() {
                return { next: () => new Promise<never>(() => {}) }
            }
        }

        // 清理 IDE 调试器环境变量，避免子进程继承后绑定同一 socket 导致启动失败
        const childEnv = { ...process.env } as Record<string, string | undefined>
        stripBunDebuggerEnv(childEnv)

        const options: Parameters<typeof query>[0]['options'] = {
            abortController,
            pathToClaudeCodeExecutable: getDefaultClaudeCodePath(),
            persistSession: false,
            env: childEnv,
        }

        // 传入 cwd 以支持项目级命令和 skills 发现
        // 目录不存在时 fallback 到 mobi 配置目录，获取全局默认 metadata（不含项目级配置）
        if (cwd && existsSync(cwd)) {
            options.cwd = cwd
        } else if (cwd) {
            logger.debug('[metadataExtractor] cwd does not exist, falling back to mobiHomeDir:', cwd)
            options.cwd = configuration.mobiHomeDir
        }

        const sdkQuery = query({
            prompt: emptyPrompt,
            options,
        })

        // 子进程初始化完成后即可获取元数据，无需等待模型响应
        const init = await sdkQuery.initializationResult()

        logger.debug('[metadataExtractor] Captured SDK metadata:', init)

        // 获取完元数据后立即关闭查询
        sdkQuery.close()

        // 返回完整的初始化响应信息
        return {
            commands: init.commands,
            agents: init.agents,
            outputStyle: init.output_style,
            availableOutputStyles: init.available_output_styles,
            models: init.models,
            account: init.account,
            fastModeState: init.fast_mode_state,
        }

    } catch (error) {
        // 检查是否是中止错误（预期行为）
        if (error instanceof Error && error.name === 'AbortError') {
            logger.debug('[metadataExtractor] SDK query aborted after capturing metadata')
            return {}
        }
        logger.debug('[metadataExtractor] Error extracting SDK metadata:', error)
        return {}
    }
}

/**
 * 异步提取 SDK 元数据，完成后回调通知
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
            logger.debug('[metadataExtractor] Async extraction failed:', error)
        })
}
