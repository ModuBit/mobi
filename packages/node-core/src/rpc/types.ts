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
 * Common RPC types and interfaces for both session and machine clients
 */

/**
 * Generic RPC handler function type
 * @template TRequest - The request data type
 * @template TResponse - The response data type
 */
export type RpcHandler<TRequest = unknown, TResponse = unknown> = (
    data: TRequest
) => TResponse | Promise<TResponse>;

/**
 * Map of method names to their handlers
 */
export type RpcHandlerMap = Map<string, RpcHandler>;

/**
 * RPC request data from server
 */
export interface RpcRequest {
    method: string;
    params: unknown; // 直接对象（daemon 不再 JSON.stringify）
}

/**
 * RPC response callback
 */
export type RpcResponseCallback = (response: unknown) => void;

/**
 * Configuration for RPC handler manager
 */
export interface RpcHandlerConfig {
    scopePrefix: string;
    logger?: (message: string, data?: unknown) => void;
}

/**
 * RPC 处理器选项
 */
export interface RpcHandlerOptions {
    /**
     * 本次 RPC 是否算作「用户交互活动」（计入会话空闲判定），默认 false。
     *
     * 白名单语义是刻意的：daemon→session 的 RPC 大多由系统动作发起（能力刷新、
     * gate 查询、跨会话投递），把它们算作活动会让空闲计时被无限期清零——历史上
     * 三次复发都在这里（逐个加 skip 补丁，每新增一条 RPC 就重新引入）。只有明确
     * 由用户操作触发的 RPC 才标 true。
     */
    countsAsUserActivity?: boolean;
}

/**
 * Result of RPC handler execution
 */
export type RpcHandlerResult<T = unknown> =
    | { success: true; data: T }
    | { success: false; error: string };
