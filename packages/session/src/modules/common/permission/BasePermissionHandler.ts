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

import type { AgentState } from "@mobi/node-core/api/types";
import type { PermissionMode } from "@mobi/shared/types";
import type { PermissionAnswers, PermissionUpdate, SDKUIHints } from "@mobi/shared";

type RpcHandlerManagerLike = {
    registerHandler<TRequest = unknown, TResponse = unknown>(
        method: string,
        handler: (params: TRequest) => Promise<TResponse> | TResponse
    ): void;
};

export type PermissionHandlerClient = {
    rpcHandlerManager: RpcHandlerManagerLike;
    updateAgentState: (handler: (state: AgentState) => AgentState) => void;
};

export type PendingPermissionRequest<TResult> = {
    resolve: (value: TResult) => void;
    reject: (error: Error) => void;
    toolName: string;
    input: unknown;
    suggestions?: PermissionUpdate[];
    toolUseID?: string;
    sdkHints?: SDKUIHints;
};

export type PermissionCompletion = {
    status: 'approved' | 'denied' | 'canceled';
    reason?: string;
    mode?: string;
    allowTools?: string[];
    answers?: PermissionAnswers;
    updatedPermissions?: PermissionUpdate[];
};

export type CancelPendingRequestOptions = {
    rejectMessage: string;
};

/**
 * YOLO（bypassPermissions）模式下权限审批是否免审放行。
 *
 * SDK 声称 bypass 全放行、不回调 canUseTool，但实测对部分工具（如 MCP 工具）仍会
 * 回调弹窗——与 YOLO 档「免审」语义矛盾。本函数收口「权限模式驱动的放行」判定单源。
 *
 * 命名避开 ask/auto 语族：dontAsk = 不问直接拒、auto = SDK 模型分类器审批，
 * 三者字面相近语义迥异，故取 bypass（= 不问直接放）。
 *
 * 策略模型（辅助判断是否放行）的演进点：替换本函数内部判定即可，调用方不动。
 */
export function shouldBypassApproval(mode: PermissionMode | undefined): boolean {
    return mode === 'bypassPermissions';
}

export abstract class BasePermissionHandler<TResponse extends { id: string }, TResult> {
    protected readonly pendingRequests = new Map<string, PendingPermissionRequest<TResult>>();
    /** 休眠 gate 事实：待处理审批数（dormancy spec） */
    get pendingCount(): number {
        return this.pendingRequests.size;
    }
    protected readonly client: PermissionHandlerClient;

    protected constructor(client: PermissionHandlerClient) {
        this.client = client;
        this.setupRpcHandler();
    }

    protected abstract handlePermissionResponse(
        response: TResponse,
        pending: PendingPermissionRequest<TResult>
    ): Promise<PermissionCompletion>;

    protected abstract handleMissingPendingResponse(response: TResponse): void;

    protected onRequestRegistered(_id: string, _toolName: string, _input: unknown): void {
    }

    protected onResponseReceived(_response: TResponse): void {
    }

    protected addPendingRequest(
        id: string,
        toolName: string,
        input: unknown,
        handlers: { resolve: (value: TResult) => void; reject: (error: Error) => void },
        extra?: { suggestions?: PermissionUpdate[]; toolUseID?: string; sdkHints?: SDKUIHints }
    ): void {
        this.pendingRequests.set(id, {
            ...handlers,
            toolName,
            input,
            suggestions: extra?.suggestions,
            toolUseID: extra?.toolUseID,
            sdkHints: extra?.sdkHints,
        });
        this.onRequestRegistered(id, toolName, input);
        this.client.updateAgentState((currentState) => ({
            ...currentState,
            requests: {
                ...currentState.requests,
                [id]: {
                    tool: toolName,
                    arguments: input,
                    createdAt: Date.now(),
                    sdkHints: extra?.sdkHints,
                    suggestions: extra?.suggestions,
                }
            }
        }));
    }

    protected finalizeRequest(id: string): void {
        this.client.updateAgentState((currentState) => {
            const request = currentState.requests?.[id];
            if (!request) return currentState;

            const nextRequests = { ...currentState.requests };
            delete nextRequests[id];

            return {
                ...currentState,
                requests: nextRequests
            };
        });
    }

    protected cancelPendingRequests(options: CancelPendingRequestOptions): void {
        for (const [, pending] of this.pendingRequests.entries()) {
            pending.reject(new Error(options.rejectMessage));
        }
        this.pendingRequests.clear();

        this.client.updateAgentState((currentState) => {
            return {
                ...currentState,
                requests: {}
            };
        });
    }

    private setupRpcHandler(): void {
        this.client.rpcHandlerManager.registerHandler<TResponse, void>('permission', async (response) => {
            const pending = this.pendingRequests.get(response.id);

            if (!pending) {
                this.handleMissingPendingResponse(response);
                return;
            }

            this.onResponseReceived(response);
            this.pendingRequests.delete(response.id);

            await this.handlePermissionResponse(response, pending);
            this.finalizeRequest(response.id);
        });
    }
}
