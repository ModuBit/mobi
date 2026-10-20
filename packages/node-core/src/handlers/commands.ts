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
import type { RpcHandlerManager } from '@mobi/node-core/rpc/RpcHandlerManager'
import { extractSDKMetadata, type SDKMetadata } from '../claudeSdk/metadataExtractor'
import { readLiveCapabilities, type LiveCapabilitySource } from '../claudeSdk/capabilityCatalog'
import { getErrorMessage, rpcError } from './rpcResponses'

export type RefreshMetadataResponse = {
    success: boolean
    metadata?: SDKMetadata
    error?: string
}

/** 活 Query 能力源；未就绪 / 本地模式返回 null */
export type LiveCapabilityGetter = () => LiveCapabilitySource | null

export interface RefreshMetadataOptions {
    /** 会话进程：优先问自己的 Query，零新增进程 */
    getLiveCapabilities?: LiveCapabilityGetter
    /** 宿主进程：cwd 级缓存（per-cwd memo + 临时探针回退） */
    getForCwd?: (cwd: string) => Promise<SDKMetadata>
}

export function registerCommandHandlers(
    rpcHandlerManager: RpcHandlerManager,
    workingDirectory?: string,
    opts?: RefreshMetadataOptions,
): void {
    // skipIdleTimerReset（pending #114）：refreshMetadata 是 daemon→session RPC 全集里
    // 唯一的 ambient 成员（SWR 后台刷新，metadata 端点命中缓存时 fire-and-forget、
    // 周期性发生）——进 idle reset 会持续清零空闲倒计时（后台刷新期间会话永不休眠）。
    // 其余 daemon→session RPC（permission/abort/rewind/config 族）都是用户显式动作，
    // 保持重置语义。与 daemon 侧 touchUpdatedAt 的 ambient opt-out 同一分类学
    rpcHandlerManager.registerHandler<{ cwd?: string }, RefreshMetadataResponse>(
        'refreshMetadata',
        (params) => refreshMetadataImpl(params, workingDirectory, opts),
        { skipIdleTimerReset: true },
    )
}

/**
 * refreshMetadata 实现（ticket-17 本地化直调目标）：注册闭包与 LocalExecutor 共用，行为单源。
 *
 * 取数优先级：活 Query → cwd 缓存 → 临时探针。
 * - 会话进程注册时带 `getLiveCapabilities`，活跃会话不再新起 CLI；
 * - daemon 宿主路径带 `getForCwd`，新会话页共享 per-cwd 缓存。
 */
export async function refreshMetadataImpl(
    params: { cwd?: string } | undefined,
    workingDirectory?: string,
    opts?: RefreshMetadataOptions,
): Promise<RefreshMetadataResponse> {
    // 优先使用 RPC 参数中的 cwd，否则使用注册时的 workingDirectory
    const effectiveCwd = params?.cwd || workingDirectory
    logger.debug('[refreshMetadata] Refreshing full SDK metadata', { cwd: effectiveCwd })

    const live = opts?.getLiveCapabilities?.()
    if (live) {
        try {
            return { success: true, metadata: await readLiveCapabilities(live) }
        } catch (error) {
            logger.debug('[refreshMetadata] live capability read failed, falling back:', error)
        }
    }

    if (opts?.getForCwd && effectiveCwd) {
        try {
            return { success: true, metadata: await opts.getForCwd(effectiveCwd) }
        } catch (error) {
            logger.debug('[refreshMetadata] cwd capability read failed, falling back:', error)
        }
    }

    try {
        const metadata = await extractSDKMetadata(effectiveCwd)
        return { success: true, metadata }
    } catch (error) {
        logger.debug('[refreshMetadata] Failed to extract SDK metadata:', error)
        return rpcError(getErrorMessage(error, 'Failed to refresh metadata'))
    }
}
