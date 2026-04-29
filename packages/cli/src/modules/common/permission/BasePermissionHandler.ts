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

import type { AgentState } from "@/api/types";
import type { PermissionMode } from "@mobi/shared/types";
import type { SDKUIHints } from "@mobi/shared";

type RpcHandlerManagerLike = {
    registerHandler<TRequest = unknown, TResponse = unknown>(
        method: string,
        handler: (params: TRequest) => Promise<TResponse> | TResponse
    ): void;
};

export type AutoApprovalDecision = 'approved' | 'approved_for_session';

export type AutoApprovalRuleSet = {
    alwaysToolNameHints?: string[];
    alwaysToolIdHints?: string[];
    writeToolNameHints?: string[];
};

const AUTO_APPROVE_TOOL_NAME_HINTS = [
    'change_title',
    'mobi__change_title',
    'think',
    'save_memory'
];
const AUTO_APPROVE_TOOL_ID_HINTS = ['change_title', 'save_memory'];
const AUTO_APPROVE_WRITE_TOOL_HINTS = ['write', 'edit', 'create', 'delete', 'patch', 'fs-edit'];

/**
 * 解析工具自动审批决策（独立函数，便于外部复用）
 */
export function resolveToolAutoApprovalDecision(
    mode: PermissionMode | undefined,
    toolName: string,
    toolCallId: string,
    ruleOverrides?: AutoApprovalRuleSet
): AutoApprovalDecision | null {
    const rules = {
        alwaysToolNameHints: ruleOverrides?.alwaysToolNameHints ?? AUTO_APPROVE_TOOL_NAME_HINTS,
        alwaysToolIdHints: ruleOverrides?.alwaysToolIdHints ?? AUTO_APPROVE_TOOL_ID_HINTS,
        writeToolNameHints: ruleOverrides?.writeToolNameHints ?? AUTO_APPROVE_WRITE_TOOL_HINTS
    };

    const lowerTool = toolName.toLowerCase();
    const lowerId = toolCallId.toLowerCase();
    const decisionForMode: AutoApprovalDecision = mode === 'bypassPermissions' ? 'approved_for_session' : 'approved';

    if (rules.alwaysToolNameHints.some((name) => lowerTool.includes(name))) {
        return decisionForMode;
    }

    if (rules.alwaysToolIdHints.some((name) => lowerId.includes(name))) {
        return decisionForMode;
    }

    // Mobi 当前仅支持 Claude 的权限模式
    if (mode === 'bypassPermissions') {
        return 'approved_for_session';
    }

    return null;
}

export type PermissionHandlerClient = {
    rpcHandlerManager: RpcHandlerManagerLike;
    updateAgentState: (handler: (state: AgentState) => AgentState) => void;
};

export type PendingPermissionRequest<TResult> = {
    resolve: (value: TResult) => void;
    reject: (error: Error) => void;
    toolName: string;
    input: unknown;
    suggestions?: unknown[];
    toolUseID?: string;
    sdkHints?: SDKUIHints;
};

export type PermissionCompletion = {
    status: 'approved' | 'denied' | 'canceled';
    reason?: string;
    mode?: string;
    /** @deprecated 未使用，权限范围由 allowTools 和 mode 决定 */
    decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort';
    allowTools?: string[];
    answers?: Record<string, string[]> | Record<string, { answers: string[] }>;
};

export type CancelPendingRequestOptions = {
    completedReason: string;
    rejectMessage: string;
    decision?: PermissionCompletion['decision'];
};

export abstract class BasePermissionHandler<TResponse extends { id: string }, TResult> {
    protected readonly pendingRequests = new Map<string, PendingPermissionRequest<TResult>>();
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

    protected resolveAutoApprovalDecision(
        mode: PermissionMode | undefined,
        toolName: string,
        toolCallId: string,
        ruleOverrides?: AutoApprovalRuleSet
    ): AutoApprovalDecision | null {
        return resolveToolAutoApprovalDecision(mode, toolName, toolCallId, ruleOverrides);
    }

    protected addPendingRequest(
        id: string,
        toolName: string,
        input: unknown,
        handlers: { resolve: (value: TResult) => void; reject: (error: Error) => void },
        extra?: { suggestions?: unknown[]; toolUseID?: string; sdkHints?: SDKUIHints }
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
                }
            }
        }));
    }

    protected finalizeRequest(id: string, completion: PermissionCompletion): void {
        this.client.updateAgentState((currentState) => {
            const request = currentState.requests?.[id];
            if (!request) return currentState;

            const nextRequests = { ...currentState.requests };
            delete nextRequests[id];

            return {
                ...currentState,
                requests: nextRequests,
                completedRequests: {
                    ...currentState.completedRequests,
                    [id]: {
                        ...request,
                        completedAt: Date.now(),
                        status: completion.status,
                        reason: completion.reason,
                        mode: completion.mode,
                        decision: completion.decision,
                        allowTools: completion.allowTools,
                        answers: completion.answers
                    }
                }
            };
        });
    }

    protected cancelPendingRequests(options: CancelPendingRequestOptions): void {
        for (const [, pending] of this.pendingRequests.entries()) {
            pending.reject(new Error(options.rejectMessage));
        }
        this.pendingRequests.clear();

        this.client.updateAgentState((currentState) => {
            const pendingRequests = currentState.requests || {};
            const completedRequests = { ...currentState.completedRequests };

            for (const [id, request] of Object.entries(pendingRequests)) {
                completedRequests[id] = {
                    ...request,
                    completedAt: Date.now(),
                    status: 'canceled',
                    reason: options.completedReason,
                    decision: options.decision
                };
            }

            return {
                ...currentState,
                requests: {},
                completedRequests
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

            const completion = await this.handlePermissionResponse(response, pending);
            this.finalizeRequest(response.id, completion);
        });
    }
}
