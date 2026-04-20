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

import { query } from '@anthropic-ai/claude-agent-sdk'
import { logger } from '@/ui/logger'
import { getDefaultClaudeCodePath } from '@/claude/sdk/utils'
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
 * 注意：必须使用非空 prompt + maxTurns >= 1，否则子进程会立即退出，
 * 导致 initializationResult() 永远无法获取响应。
 * 通过 allowedTools 限制工具范围以最小化开销。
 *
 * @returns SDK 元数据，包含完整的初始化响应信息
 */
export async function extractSDKMetadata(): Promise<SDKMetadata> {
    const abortController = new AbortController()

    try {
        logger.debug('[metadataExtractor] Starting SDK metadata extraction')

        // 使用最小化配置创建查询，确保子进程存活足够久
        const sdkQuery = query({
            prompt: 'echo hi',
            options: {
                maxTurns: 1,
                abortController,
                allowedTools: ['Bash(echo)'],
                pathToClaudeCodeExecutable: getDefaultClaudeCodePath(),
                persistSession: false,
            }
        })

        // 使用官方 SDK 的 initializationResult() 方法
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
 * Extract SDK metadata asynchronously without blocking
 * Fires the extraction and updates metadata when complete
 */
export function extractSDKMetadataAsync(onComplete: (metadata: SDKMetadata) => void): void {
    extractSDKMetadata()
        .then(metadata => {
            if (metadata.agents || metadata.commands) {
                onComplete(metadata)
            }
        })
        .catch(error => {
            logger.debug('[metadataExtractor] Async extraction failed:', error)
        })
}
