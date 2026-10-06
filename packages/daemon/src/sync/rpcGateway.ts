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
 * 会话进程族 RPC 网关（daemon → CLI，按 sessionId 路由）。
 *
 * machine 族（按 machineId 路由）在 ticket-17/20 已本地直调化，本类只剩会话族，
 * 传输语义在 {@link SocketRpcCaller}。
 */

import type { EffortLevel, PermissionMode } from '@mobi/shared/types'
import { DEFAULT_STOP_KIND, type AgentMessageDelivery, type AgentMessagePushResult, type PermissionAnswers, type PermissionUpdate, type StopKind } from '@mobi/shared'
import type { Server } from 'socket.io'
import type { RpcRegistry } from '../socket/rpcRegistry'
import type { RpcRefreshMetadataResponse } from '../executor/executorHost'
import { SocketRpcCaller } from './rpcCaller'

export class RpcGateway {
    private readonly caller: SocketRpcCaller

    constructor(
        io: Server,
        rpcRegistry: RpcRegistry
    ) {
        this.caller = new SocketRpcCaller(io, rpcRegistry)
    }

    async approvePermission(
        sessionId: string,
        requestId: string,
        mode?: PermissionMode,
        decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort',
        answers?: PermissionAnswers,
        updatedPermissions?: PermissionUpdate[]
    ): Promise<void> {
        await this.sessionRpc(sessionId, 'permission', {
            id: requestId,
            approved: true,
            mode,
            decision,
            answers,
            updatedPermissions
        })
    }

    async denyPermission(
        sessionId: string,
        requestId: string,
        decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort',
        reason?: string
    ): Promise<void> {
        await this.sessionRpc(sessionId, 'permission', {
            id: requestId,
            approved: false,
            decision,
            reason
        })
    }

    async abortSession(sessionId: string, stopKind: StopKind = DEFAULT_STOP_KIND): Promise<void> {
        await this.sessionRpc(sessionId, 'abort', { reason: 'User aborted via Mobi', stopKind })
    }

    async switchSession(sessionId: string, to: 'remote' | 'local'): Promise<void> {
        await this.sessionRpc(sessionId, 'switch', { to })
    }

    async requestSessionConfig(
        sessionId: string,
        config: {
            permissionMode?: PermissionMode
            model?: string | null
            effort?: EffortLevel
        }
    ): Promise<unknown> {
        return await this.sessionRpc(sessionId, 'set-session-config', config)
    }

    // output style 切换（/clear 语义受理，CLI 侧守卫 running/rewind）
    async switchOutputStyle(sessionId: string, style: string): Promise<unknown> {
        return await this.sessionRpc(sessionId, 'switch-output-style', { style })
    }

    // Mobi → CC 标题同步：通知 CLI 调 SDK renameSession 回写 CC customTitle
    async requestRename(sessionId: string, title: string): Promise<void> {
        await this.sessionRpc(sessionId, 'rename-session', { title })
    }

    // rewind 预检：CLI 用 getSessionMessages 锚点预检 + rewindFiles(dryRun)，返回 { canRewind, canRestoreFiles }
    async rewindDryRun(sessionId: string, nativeId: string): Promise<unknown> {
        return await this.sessionRpc(sessionId, 'rewind-dry-run', { nativeId })
    }

    // rewind 执行（只做受理：CLI 闸门通过即返 accepted，结果经 socket 两段回报上报）
    async rewind(sessionId: string, nativeId: string, restoreFiles: boolean): Promise<unknown> {
        return await this.sessionRpc(sessionId, 'rewind', { nativeId, restoreFiles })
    }

    /** 手动休眠预检（dormancy spec §D.11）：CLI 本地 gate 自查，阻塞时逐项 blocker 返回 */
    async dormancyCheck(sessionId: string): Promise<{ ok: boolean; blockers: string[] }> {
        return await this.sessionRpc(sessionId, 'dormancyCheck', {}) as { ok: boolean; blockers: string[] }
    }

    async killSession(sessionId: string): Promise<void> {
        await this.sessionRpc(sessionId, 'killSession', {})
    }

    async refreshMetadata(sessionId: string): Promise<RpcRefreshMetadataResponse> {
        return await this.sessionRpc(sessionId, 'refreshMetadata', {}) as RpcRefreshMetadataResponse
    }

    // 停止后台任务
    async stopTask(sessionId: string, taskId: string): Promise<void> {
        await this.sessionRpc(sessionId, 'stop-task', { taskId })
    }

    // 取消 CLI 内存队列中已缓冲的排队消息（两阶段取消的 CLI 侧）
    async cancelCliQueuedMessage(sessionId: string, localId: string): Promise<{ status: 'cancelled' | 'submitted' }> {
        const res = await this.sessionRpc(sessionId, 'cancel-queued-message', { localId })
        return (res ?? { status: 'submitted' }) as { status: 'cancelled' | 'submitted' }
    }

    // steer CLI 内存队列中的排队消息：立即提交给 SDK input stream
    async steerCliQueuedMessage(sessionId: string, localId: string): Promise<{ status: 'steered' | 'submitted' }> {
        const res = await this.sessionRpc(sessionId, 'steer-queued-message', { localId })
        return (res ?? { status: 'submitted' }) as { status: 'steered' | 'submitted' }
    }

    /**
     * 把一条跨会话消息投给目标会话的 CLI（daemon → CLI）。
     *
     * 与 steerCliQueuedMessage 的分界：那条从**目标自己的投递队列**里取出排队消息，
     * 有本地排队态、要绑定 native_id；这条不走队列——消息由别的会话投来，
     * 目标侧从没排过队，`localIds` 也不传（消息身份已由信封携带）。
     *
     * **调用方明确的拒收走返回值，不走异常**——拒收是确定性的业务裁决，而异常通道
     * 那边是**传输故障**（无 handler / socket 断 / 超时），抛出时就带上了分类
     * （`RpcFailure`）；要是一条恰好含 "timed out" 的拒收理由走了异常通道，会被
     * 说成「可能已送达、别重发」，把确定的事说成不确定。只有真·传输故障才抛。
     *
     * **`rejected` 也是失败**（见 AgentMessagePushResult）：那表示 CLI 跑了 handler 却
     * 没收下（input stream 已关）。静默当成功会落一条永远不会被处理的库行，还告诉
     * agent「送到了」——比报错坏得多。
     */
    async pushAgentMessage(sessionId: string, delivery: AgentMessageDelivery): Promise<AgentMessagePushResult> {
        const result = await this.sessionRpc(sessionId, 'push-agent-message', delivery) as AgentMessagePushResult | null
        if (result?.status === 'delivered') {
            return result
        }
        // CLI 那边的 reason 本就是给人看的句子（谁收不下、为什么），原样带到调用方；
        // 返回 null（没确认）也算拒收，只是理由换成我们给的这一句
        return {
            status: 'rejected',
            reason: result?.status === 'rejected' ? result.reason : 'the session did not confirm delivery',
        }
    }

    private async sessionRpc(sessionId: string, method: string, params: unknown): Promise<unknown> {
        return await this.caller.call(`${sessionId}:${method}`, params)
    }
}
