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

import { logger } from '@mobi/node-core/logger'
import type { AgentInfo, ModelInfo, SlashCommand } from '@mobi/shared'

/** 三方法返回的能力面（写入 metadata.sdkMetadata 的子集；output style 两字段供 web 切换器消费） */
export interface SessionCapabilities {
    models: ModelInfo[]
    commands: SlashCommand[]
    agents: AgentInfo[]
    /** 当前 output style（init 上报 `output_style`；web 切换器当前值显示的数据源） */
    outputStyle?: string
    /** 可选 output style 列表（init 上报 `available_output_styles`，含用户自定义名） */
    availableOutputStyles?: string[]
}

/** 能力发现所需的 Query 结构子集（不 import SDK 类型，便于测试替身） */
interface CapabilityQuery {
    initializationResult(): Promise<unknown>
    supportedModels(): Promise<ModelInfo[]>
    supportedCommands(): Promise<SlashCommand[]>
    supportedAgents(): Promise<AgentInfo[]>
}

/** 插件加载失败条目（SDK 0.3.283，system/init.plugin_errors；键省略 = 无错误，
 *  Remote worker 形态恒省略）。type 是开放集合，未知值按 generic 语义处理 */
export type PluginLoadError = { plugin: string; type: string; message: string; path?: string }

/** plugin_errors 条目 → 人读明文（唯一格式化点：sdkOutputLoop 合成横幅等消费方共用，
 *  禁止在调用方内联同模板——格式漂移历史见 /simplify 盘点） */
export function formatPluginError(e: PluginLoadError): string {
    return `${e.plugin} (${e.type})${e.path ? ` @ ${e.path}` : ''}: ${e.message}`
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
        const init = (await query.initializationResult() ?? {}) as {
            output_style?: string
            available_output_styles?: string[]
            plugin_errors?: PluginLoadError[]
        }
        // 插件加载错误的可观测 owner 是 sdkOutputLoop（合成 warning 横幅 + warn 日志，
        // 覆盖本函数的全部场景且不依赖能力三件套是否可信）——此处不再重复打
        const [models, commands, agents] = await Promise.all([
            query.supportedModels(),
            query.supportedCommands(),
            query.supportedAgents(),
        ])
        // 空结果守卫（对齐旧 extractor 的 agents||commands 门）：三件套全空说明发现不可信，
        // 不覆写 daemon 旧快照（web 模型选择器/命令面板将清空），保旧值待下代进程再刷
        if (models.length === 0 && commands.length === 0 && agents.length === 0) {
            logger.debug('[capabilityDiscovery] empty capability set, keeping stale metadata')
            return
        }
        onCapabilities({
            models,
            commands,
            agents,
            outputStyle: init.output_style,
            availableOutputStyles: init.available_output_styles,
        })
    } catch (e) {
        logger.debug('[capabilityDiscovery] failed, keeping stale metadata:', e)
    }
}
