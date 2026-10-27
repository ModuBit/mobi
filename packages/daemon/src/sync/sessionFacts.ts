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

import type { CacheStatus, ContextUsage, EffortLevel, PermissionMode, SessionEndReason, SessionGovernanceSnapshot, SessionPauseTrigger } from '@mobi/shared/types'

/**
 * CLI 会话「事实上报」管线（深化候选③）：CLI 运行时持续上报会话实时状态
 * （心跳 / 水位 / 目标 / 轮次起点 / 结束），daemon 校验鉴权后落库 runtimeState + SSE 推 web。
 *
 * 本文件是载荷类型与 sink 接口的单一声明源——此前同一组回调签名在
 * SessionHandlersDeps / CliHandlersDeps / SocketServerDeps 手写三遍且已漂移
 * （server.ts 的 onSessionAlive 载荷丢了 4 个配置字段）。
 */

export type SessionAlivePayload = {
    sid: string
    time: number
    running?: boolean
    mode?: 'local' | 'remote'
    permissionMode?: PermissionMode
    model?: string | null
    effort?: EffortLevel
    fastMode?: boolean
    outputStyle?: string
    /** 治理水位快照（票 1.2 搭车）：只进 SessionRegistry，不落库不广播 */
    governance?: SessionGovernanceSnapshot
}

export type SessionEndPayload = {
    sid: string
    time: number
    /** 会话终结原因（票 1.1 单出口）；老 CLI 缺省（透传兼容），落库时按 stop 处理 */
    endReason?: SessionEndReason
    pauseTrigger?: SessionPauseTrigger
}

export type ContextUsagePayload = {
    sid: string
    /** null 表示清空（/clear / output style 切换重启） */
    contextUsage: ContextUsage | null
}

export type RunStartedPayload = {
    sid: string
    /** 轮次起点（epoch ms，CLI running 翻转 false→true 时上报） */
    runStartedAt: number
}

export type ReceiveReadinessPayload = {
    sid: string
    /**
     * 本会话此刻能不能收消息（CLI 的 sink 接通 / 断开时各上报一次）。
     *
     * 与其它事实不同，这一条**不落库**：它随会话进程生灭，跨进程重启没有意义。它只是
     * 「此刻」的状态，会被反复翻转（sink 每轮收尾清空、下一轮再接上）。
     */
    canReceive: boolean
}

export type CacheStatusPayload = {
    sid: string
    /** null 表示清空（首个 result 帧到达后 CLI 清除） */
    cacheStatus: CacheStatus | null
}

/**
 * 会话事实上报的落库入口（seam）：socket 层完成校验与鉴权后调用，实现方为 SyncEngine /
 * SessionCache。
 */
export type SessionFactsSink = {
    handleSessionAlive?: (payload: SessionAlivePayload) => void
    handleSessionEnd?: (payload: SessionEndPayload) => void
    handleContextUsage?: (payload: ContextUsagePayload) => void
    handleRunStarted?: (payload: RunStartedPayload) => void
    handleCacheStatus?: (payload: CacheStatusPayload) => void
    /** 不落库的「此刻」事实，只喂 SessionReceiveReadiness（见该模块说明） */
    handleReceiveReadiness?: (payload: ReceiveReadinessPayload) => void
}
