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
 * socket 传输 fake 三件套（SocketRpcCaller 测试共用）：fake socket / fake io / fake registry。
 * ticket-20 起 machine socket 通道已删（SocketMachineHost 退场），只剩会话族
 * RpcGateway 的测试用这套 fake。
 */

import type { RpcRegistry } from '../../../src/socket/rpcRegistry'

/**
 * 捕获 emitWithAck 的 payload，并按预设返回 response。
 * payloadCaptor 用闭包持有最后一次传入的 params，供断言使用。
 */
export interface FakeSocketOptions {
    /** emitWithAck 返回的响应 */
    response?: unknown
    /** emitWithAck **拒绝**时抛出的错（模拟 socket.io 的 ack 超时或别的传输异常） */
    rejects?: unknown
    /** 用于断言「捕获到什么」的写入槽 */
    payloadCaptor: { value: unknown }
}

/** 构造一个可被 SocketRpcCaller 使用的 fake socket */
export function makeFakeSocket(opts: FakeSocketOptions) {
    return {
        timeout() {
            return this
        },
        async emitWithAck(_event: string, payload: unknown) {
            // 捕获整个 rpc-request 信封，便于断言 params 是否为对象
            opts.payloadCaptor.value = payload
            if (opts.rejects !== undefined) throw opts.rejects
            return opts.response
        },
    }
}

/** 构造 fake io：io.of('/cli').sockets.get(socketId) → fakeSocket */
export function makeFakeIo(socketId: string, socket: ReturnType<typeof makeFakeSocket>) {
    const sockets = new Map<string, unknown>([[socketId, socket]])
    return {
        of() {
            return { sockets }
        },
    } as unknown as import('socket.io').Server
}

/** 构造 fake rpcRegistry */
export function makeFakeRegistry(methodToSocketId: Map<string, string | null>): RpcRegistry {
    return {
        getSocketIdForMethod(method: string) {
            return methodToSocketId.get(method) ?? null
        },
    } as unknown as RpcRegistry
}
