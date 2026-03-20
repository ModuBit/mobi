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

export interface SDKMetadata {
    agents?: string[]
    slashCommands?: string[]
}

/**
 * 使用官方 SDK 的 initializationResult() 方法提取元数据
 * @returns SDK 元数据，包含代理和斜杠命令列表
 */
export async function extractSDKMetadata(): Promise<SDKMetadata> {
    const abortController = new AbortController()

    try {
        logger.debug('[metadataExtractor] Starting SDK metadata extraction')

        // 使用空提示和最小配置创建查询
        const sdkQuery = query({
            prompt: '',
            options: {
                maxTurns: 0,
                abortController,
            }
        })

        // 使用官方 SDK 的 initializationResult() 方法
        const init = await sdkQuery.initializationResult()

        logger.debug('[metadataExtractor] Captured SDK metadata:', init)

        // 关闭查询（close 会自动中止）
        sdkQuery.close()

        return {
            agents: init.agents?.map(a => a.name),
            slashCommands: init.commands?.map(c => c.name),
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
            if (metadata.agents || metadata.slashCommands) {
                onComplete(metadata)
            }
        })
        .catch(error => {
            logger.debug('[metadataExtractor] Async extraction failed:', error)
        })
}
