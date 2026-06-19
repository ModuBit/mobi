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
    params: string; // JSON string
}

/**
 * RPC response callback
 */
export type RpcResponseCallback = (response: string) => void;

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
    /** 是否跳过空闲计时器重置，默认 false */
    skipIdleTimerReset?: boolean;
}

/**
 * Result of RPC handler execution
 */
export type RpcHandlerResult<T = unknown> =
    | { success: true; data: T }
    | { success: false; error: string };
