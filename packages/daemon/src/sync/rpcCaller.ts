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
 * socket 传输调用器（ticket-15 自 rpcGateway 抽出）。
 *
 * Hub → CLI（session 族）与 Hub → machine（machine 族）两条 RPC 通道共用同一个
 * `rpc-request` 事件与同一套故障分类。此前传输逻辑长在 RpcGateway 里；MachineHost
 * 拆出后两个适配器（RpcGateway / SocketMachineHost）各持一个本类实例，传输语义
 * 仍只写一份（行为零变化）。
 */

import type { Server } from 'socket.io'
import type { RpcRegistry } from '../socket/rpcRegistry'
import { RpcFailure, type RpcFailureKind } from './rpcFailure'

/**
 * 把一句**别处产出的传输层散文**读成一类故障——传输适配层唯一还在读文案的地方。
 *
 * 之所以还剩这一处：三类故障里有两类的句子不是 hub 产的——socket.io 的 ack 超时
 * （`operation has timed out`）由框架给，runner 等会话 webhook 超时
 * （`Session webhook timeout for PID N`）**由另一个进程**给。要彻底不读文案，得让
 * runner 的回执带结构化字段，那是 docs/pending.md #78 要回答的事。
 *
 * 与之相对，`unreachable` 的两句是本层自己抛的，**在抛出那一刻就带上了分类**，
 * 不在这儿再认一遍——给自己产的句子留一条猜测后路，正是这套分类要拆掉的东西。
 *
 * 两类超时共用一条规则：socket.io 的 ack 超时与 runner 的 webhook 超时都含
 * timeout / timed out。
 */
export function classifyTransportFailure(message: string): RpcFailureKind {
    return /timed?\s*out/i.test(message) ? 'timeout' : 'other'
}

export class SocketRpcCaller {
    constructor(
        private readonly io: Server,
        private readonly rpcRegistry: RpcRegistry
    ) {
    }

    async call(method: string, params: unknown): Promise<unknown> {
        const socketId = this.rpcRegistry.getSocketIdForMethod(method)
        if (!socketId) {
            // 「不可达」这件事这里就知道，不必让下游从句子反解（见 rpcFailure 模块头）
            throw new RpcFailure('unreachable', `RPC handler not registered: ${method}`)
        }

        const socket = this.io.of('/cli').sockets.get(socketId)
        if (!socket) {
            throw new RpcFailure('unreachable', `RPC socket disconnected: ${method}`)
        }

        try {
            // Socket.IO 原生序列化：params 对象直传，响应对象直收（含二进制附件）
            return await socket.timeout(30_000).emitWithAck('rpc-request', {
                method,
                params
            }) as unknown
        } catch (error) {
            // 这里抛出来的句子是**框架给的**（ack 超时），只能按文案读
            const message = error instanceof Error ? error.message : String(error)
            throw new RpcFailure(classifyTransportFailure(message), message)
        }
    }
}
