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
 * sdkMetadata 后台刷新（对「最终应用」负责的单点）。
 *
 * 背景：`/` 面板的命令清单以会话维度 sdkMetadata 为源，与 skillsRoot 查询缓存是两套
 * 缓存（queryKey 不相交）。清单变更（管理页装卸/启停/安装、会话内 reload 命令）必须
 * 主动刷新受影响的活跃会话，否则收敛只能依赖 CC 目录 watcher 的 commands_changed
 * （daemon 侧零承诺）。
 *
 * 为什么收成一个模块：刷新要过四道闸，此前散在 SyncEngine 里，且最前面的并发闸会
 * **静默丢弃 force**——接口承诺「force = 清单肯定变了」，实现却在另一层食言：
 * 1. 活跃闸：CLI 不在线的会话 RPC 必失败/超时（还占去重槽位），提前跳过；
 * 2. 节流闸：web 每次 metadata GET 都触发刷新，30s 内复用上次结果；
 *    force（离散清单事件）绕过——事件语义不能被 GET 节流窗口吞掉；
 * 3. 并发闸：同一会话同时只跑一个 refreshMetadata。普通请求合并丢弃即可；
 *    force 记入待办，本轮落地后补跑一轮——force 永不静默丢弃；
 * 4. 应用闸：apply 时比对发起前快照的 metadataVersion（RPC 期间若有别处写入则放弃
 *    stale 结果）；内容相等则不写库不发 SSE（打破 refetch↔SSE 循环，归 sessionCache）。
 *
 * 清单变更的作用面由事件显式携带（global / workspace / session），本模块按作用面圈定
 * 目标会话——发布方不再用「workspaceId 是否为 null」间接表达范围，也不会再出现
 * 「会话内 reload 外溢到同工作区全部会话」的放大。
 */

import type { SDKMetadata } from '@mobi/shared/types'
import type { RpcRefreshMetadataResponse } from '../executor/executorHost'
import { daemonLogger } from '../logger'
import type { SkillInventoryRefreshTarget } from './skillInventoryBus'

/** 刷新模块需要的会话视图（结构化取值，不绑 Session 全量字段） */
export interface RefresherSession {
    id: string
    active: boolean
    namespace: string
    /** 未归属工作区时缺省或为 null（Session 投影原样取值） */
    workspaceId?: string | null
    metadataVersion: number
}

export interface SdkMetadataRefresherDeps {
    getSession(sessionId: string): RefresherSession | undefined
    getSessionsByNamespace(namespace: string): RefresherSession[]
    refreshMetadata(sessionId: string): Promise<RpcRefreshMetadataResponse>
    /** 应用刷新结果（含版本闸与等价闸）；返回是否实际发生变更 */
    applyRefreshedSDKMetadata(sessionId: string, metadata: SDKMetadata, expectedVersion: number): boolean
    /** 时钟注入（测试用）；缺省 Date.now */
    now?(): number
}

export class SdkMetadataRefresher {
    /** 后台刷新最小间隔：web 每次 metadata GET 都会触发，30s 内复用上次结果 */
    private static readonly DEFAULT_MIN_INTERVAL_MS = 30_000
    /** 节流表容量上限（长跑 daemon 的会话集合不无界增长） */
    private static readonly THROTTLE_TABLE_LIMIT = 512

    /** 同一会话同时只跑一个 RPC */
    private readonly inflight = new Set<string>()
    /** 飞行期间到达的 force：本轮落地后补跑（并发闸不得吞掉 force 的承诺） */
    private readonly forcePending = new Set<string>()
    private readonly lastStartedAt = new Map<string, number>()
    private readonly minIntervalMs: number

    constructor(
        private readonly deps: SdkMetadataRefresherDeps,
        options?: { minIntervalMs?: number },
    ) {
        this.minIntervalMs = options?.minIntervalMs ?? SdkMetadataRefresher.DEFAULT_MIN_INTERVAL_MS
    }

    /**
     * 单会话刷新请求（SWR 配套与事件扇出的共同入口）。
     * 返回本轮 RPC 的完成 Promise；被合并/节流/跳过时立即 resolve，调用方可 fire-and-forget。
     */
    request(sessionId: string, options?: { force?: boolean }): Promise<void> {
        const force = options?.force === true
        // CLI 不在线时 RPC 必失败/超时，提前跳过省资源（web 仍用缓存）
        const session = this.deps.getSession(sessionId)
        if (!session?.active) return Promise.resolve()
        if (this.inflight.has(sessionId)) {
            if (force) this.forcePending.add(sessionId)
            return Promise.resolve()
        }
        const now = this.deps.now?.() ?? Date.now()
        const last = this.lastStartedAt.get(sessionId) ?? 0
        if (!force && now - last < this.minIntervalMs) return Promise.resolve()
        this.lastStartedAt.set(sessionId, now)
        this.pruneThrottleTable()
        return this.execute(sessionId, session.metadataVersion)
    }

    /** 清单变更事件入口：按事件声明的显式作用面圈定活跃会话 */
    refreshInventory(namespace: string, target: SkillInventoryRefreshTarget): void {
        if (target.kind === 'session') {
            void this.request(target.sessionId, { force: true })
            return
        }
        for (const session of this.deps.getSessionsByNamespace(namespace)) {
            if (!session.active) continue
            if (target.kind === 'workspace' && session.workspaceId !== target.workspaceId) continue
            void this.request(session.id, { force: true })
        }
    }

    private async execute(sessionId: string, versionBefore: number): Promise<void> {
        daemonLogger.debug('[capability] background-refresh', { sessionId })
        this.inflight.add(sessionId)
        try {
            const result = await this.deps.refreshMetadata(sessionId)
            if (!result.success || !result.metadata) return
            this.deps.applyRefreshedSDKMetadata(sessionId, result.metadata, versionBefore)
        } catch {
            // RPC 失败 — 静默，web 继续用缓存
        } finally {
            this.inflight.delete(sessionId)
            if (this.forcePending.delete(sessionId)) {
                // force 在飞行期间到达：补跑一轮，保证「清单肯定变了」最终被应用
                void this.request(sessionId, { force: true })
            }
        }
    }

    private pruneThrottleTable(): void {
        if (this.lastStartedAt.size <= SdkMetadataRefresher.THROTTLE_TABLE_LIMIT) return
        const oldest = this.lastStartedAt.keys().next().value
        if (oldest !== undefined) this.lastStartedAt.delete(oldest)
    }
}
