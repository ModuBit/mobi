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

import { logger } from '@/ui/logger'
import type { AgentInfo, ModelInfo, SlashCommand } from '@mobi/shared'

/** 三方法返回的能力面（写入 metadata.sdkMetadata 的子集；其余字段不再产出，web 零消费已核实） */
export interface SessionCapabilities {
    models: ModelInfo[]
    commands: SlashCommand[]
    agents: AgentInfo[]
}

/** 能力发现所需的 Query 结构子集（不 import SDK 类型，便于测试替身） */
interface CapabilityQuery {
    initializationResult(): Promise<unknown>
    supportedModels(): Promise<ModelInfo[]>
    supportedCommands(): Promise<SlashCommand[]>
    supportedAgents(): Promise<AgentInfo[]>
}

/**
 * 会话能力面发现（spec 批次 G U-27）：在会话自己的 Query 上调 SDK 三方法，
 * 替代 extractSDKMetadataAsync 专用 headless 进程。
 * 锚 initializationResult（initialize 完成的权威信号）后并行拉取；
 * 失败静默——metadata 保持旧值（resume 场景为上次快照），下代进程重启再刷。
 * 调用方以 `void` fire-and-forget，本函数不向上抛。
 */
export async function discoverCapabilities(
    query: CapabilityQuery,
    onCapabilities: (caps: SessionCapabilities) => void,
): Promise<void> {
    try {
        await query.initializationResult()
        const [models, commands, agents] = await Promise.all([
            query.supportedModels(),
            query.supportedCommands(),
            query.supportedAgents(),
        ])
        // 空结果守卫（对齐旧 extractor 的 agents||commands 门）：三件套全空说明发现不可信，
        // 不覆写 hub 旧快照（web 模型选择器/命令面板将清空），保旧值待下代进程再刷
        if (models.length === 0 && commands.length === 0 && agents.length === 0) {
            logger.debug('[capabilityDiscovery] empty capability set, keeping stale metadata')
            return
        }
        onCapabilities({ models, commands, agents })
    } catch (e) {
        logger.debug('[capabilityDiscovery] failed, keeping stale metadata:', e)
    }
}
