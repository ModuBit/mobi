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
 * Generic RPC handler manager for session and machine clients
 * Manages RPC method registration and handler execution (no encryption).
 */

import { logger as defaultLogger } from '@/ui/logger'
import type { RpcHandler, RpcHandlerConfig, RpcRequest, RpcHandlerOptions } from './types'
import type { Socket } from 'socket.io-client'

/**
 * 处理器条目，包含处理器和选项
 */
type HandlerEntry = {
    handler: RpcHandler;
    options?: RpcHandlerOptions;
};

export class RpcHandlerManager {
    private handlers: Map<string, HandlerEntry> = new Map()
    private readonly scopePrefix: string
    private readonly logger: (message: string, data?: unknown) => void
    private socket: Socket | null = null
    private onRpcCalled?: () => void

    constructor(config: RpcHandlerConfig) {
        this.scopePrefix = config.scopePrefix
        this.logger = config.logger || ((msg, data) => defaultLogger.debug(msg, data))
    }

    /**
     * 设置 RPC 调用回调（用于重置空闲计时器）
     */
    setOnRpcCalled(callback: (() => void) | undefined): void {
        this.onRpcCalled = callback;
    }

    registerHandler<TRequest = unknown, TResponse = unknown>(
        method: string,
        handler: RpcHandler<TRequest, TResponse>,
        options?: RpcHandlerOptions
    ): void {
        const prefixedMethod = this.getPrefixedMethod(method)

        // RPC 边界：handler 泛型擦除为 unknown（params 直传对象）
        this.handlers.set(prefixedMethod, {
            handler: handler as unknown as RpcHandler,
            options
        })

        if (this.socket) {
            this.socket.emit('rpc-register', { method: prefixedMethod })
        }
    }

    async handleRequest(request: RpcRequest): Promise<unknown> {
        try {
            const entry = this.handlers.get(request.method)
            if (!entry) {
                this.logger('[RPC] [ERROR] Method not found', { method: request.method })
                return { error: 'Method not found' }
            }

            // 检查是否跳过计时器重置
            if (!entry.options?.skipIdleTimerReset && this.onRpcCalled) {
                this.onRpcCalled()
            }

            // params 已是对象（RPC 边界不再 JSON.stringify）
            const result = await entry.handler(request.params)
            return result
        } catch (error) {
            const details = error instanceof Error
                ? { message: error.message, stack: error.stack }
                : { error: String(error) }
            this.logger('[RPC] [ERROR] Error handling request', details)
            return { error: error instanceof Error ? error.message : 'Unknown error' }
        }
    }

    onSocketConnect(socket: Socket): void {
        this.socket = socket
        for (const [prefixedMethod] of this.handlers) {
            socket.emit('rpc-register', { method: prefixedMethod })
        }
    }

    onSocketDisconnect(): void {
        this.socket = null
    }

    getHandlerCount(): number {
        return this.handlers.size
    }

    hasHandler(method: string): boolean {
        const prefixedMethod = this.getPrefixedMethod(method)
        return this.handlers.has(prefixedMethod)
    }

    clearHandlers(): void {
        this.handlers.clear()
        this.logger('Cleared all RPC handlers')
    }

    private getPrefixedMethod(method: string): string {
        return `${this.scopePrefix}:${method}`
    }
}

export function createRpcHandlerManager(config: RpcHandlerConfig): RpcHandlerManager {
    return new RpcHandlerManager(config)
}
