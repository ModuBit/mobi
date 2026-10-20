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
import { readLiveCapabilities, type LiveCapabilitySource } from '@mobi/node-core/claudeSdk/capabilityCatalog'
import type { SDKMetadata } from '@mobi/shared'

/** 插件加载失败条目（SDK 0.3.283，system/init.plugin_errors；键省略 = 无错误，
 *  Remote worker 形态恒省略）。type 是开放集合，未知值按 generic 语义处理 */
export type PluginLoadError = { plugin: string; type: string; message: string; path?: string }

/** plugin_errors 条目 → 人读明文（唯一格式化点：sdkOutputLoop 合成横幅等消费方共用，
 *  禁止在调用方内联同模板——格式漂移历史见 /simplify 盘点） */
export function formatPluginError(e: PluginLoadError): string {
    return `${e.plugin} (${e.type})${e.path ? ` @ ${e.path}` : ''}: ${e.message}`
}

/**
 * 会话能力面发现（spec 批次 G U-27）：在会话自己的 Query 上取能力三件套，
 * 写回 sdkMetadata。投影与空结果守卫由 {@link readLiveCapabilities} 单源承载
 * （与 refreshMetadata 的活 Query 路径同一份实现）。
 *
 * 调用方以 `void` fire-and-forget，本函数不向上抛；失败静默——metadata 保持旧值
 * （resume 场景为上次快照），下代进程重启再刷。
 */
export async function discoverCapabilities(
    source: LiveCapabilitySource,
    onCapabilities: (caps: SDKMetadata) => void,
): Promise<void> {
    try {
        onCapabilities(await readLiveCapabilities(source))
    } catch (e) {
        logger.debug('[capabilityDiscovery] failed, keeping stale metadata:', e)
    }
}
