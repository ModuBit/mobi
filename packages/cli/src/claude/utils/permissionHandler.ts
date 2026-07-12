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
 * Permission Handler for canCallTool integration
 * 
 * Replaces the MCP permission server with direct SDK integration.
 * Handles tool permission requests, responses, and state management.
 */

import { logger } from "@/lib";
import type { SDKMessage, SDKTaskStartedMessage } from "@anthropic-ai/claude-agent-sdk";
import type { PermissionResult, PermissionUpdate, PermissionDecisionClassification } from "../sdk/types";
import type { SDKUIHints } from "@mobi/shared";
import { PLAN_FAKE_REJECT, PLAN_FAKE_RESTART } from "../sdk/prompts";
import { Session } from "../session";
import { PermissionMode } from "../types";
import { isObject } from "@mobi/shared";
import {
    BasePermissionHandler,
    type PendingPermissionRequest,
    type PermissionCompletion
} from "@/modules/common/permission/BasePermissionHandler";

interface PermissionResponse {
    id: string;
    approved: boolean;
    reason?: string;
    mode?: PermissionMode;
    allowTools?: string[];
    answers?: Record<string, string | string[]> | Record<string, { answers: string[] }>;
    receivedAt?: number;
    /** @deprecated 未使用，权限范围由 allowTools 和 mode 决定 */
    decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort';
}

const PLAN_EXIT_MODES: PermissionMode[] = ['default', 'acceptEdits', 'bypassPermissions'];

function isAskUserQuestionToolName(toolName: string): boolean {
    return toolName === 'AskUserQuestion' || toolName === 'ask_user_question';
}

function isRequestUserInputToolName(toolName: string): boolean {
    return toolName === 'RequestUserInput' || toolName === 'request_user_input';
}

function isQuestionToolName(toolName: string): boolean {
    return isAskUserQuestionToolName(toolName) || isRequestUserInputToolName(toolName);
}

function buildAskUserQuestionUpdatedInput(input: unknown, answers: Record<string, string | string[]> | Record<string, { answers: string[] }>): Record<string, unknown> {
    // 归一化为 flat 格式并转为 SDK 要求的 string value
    const sdkAnswers: Record<string, string> = {};
    for (const [key, value] of Object.entries(answers)) {
        let flat: string[];
        if (typeof value === 'string') {
            flat = [value];
        } else if (Array.isArray(value)) {
            flat = value;
        } else if (value && typeof value === 'object' && 'answers' in value) {
            flat = value.answers;
        } else {
            continue;
        }
        sdkAnswers[key] = flat.join(', ');
    }

    if (!isObject(input)) {
        return { answers: sdkAnswers };
    }

    return {
        ...input,
        answers: sdkAnswers
    };
}

/**
 * Build updated input for request_user_input tool
 * The answers format is nested: { answers: { [id]: { answers: string[] } } }
 */
function buildRequestUserInputUpdatedInput(input: unknown, answers: unknown): Record<string, unknown> {
    if (!isObject(input)) {
        return { answers };
    }

    return {
        ...input,
        answers
    };
}

export class PermissionHandler extends BasePermissionHandler<PermissionResponse, PermissionResult> {
    private responses = new Map<string, PermissionResponse>();
    private session: Session;
    private allowedTools = new Set<string>();
    private allowedBashLiterals = new Set<string>();
    private allowedBashPrefixes = new Set<string>();
    private permissionMode: PermissionMode = 'default';
    private onPermissionRequestCallback?: (toolCallId: string) => void;
    /** agentID → { description, subagentType }，从 task_started 系统消息中提取 */
    private agentInfoMap = new Map<string, { description: string; subagentType?: string }>();

    constructor(session: Session) {
        super(session.client);
        this.session = session;
    }
    
    /**
     * Set callback to trigger when permission request is made
     */
    setOnPermissionRequest(callback: (toolCallId: string) => void) {
        this.onPermissionRequestCallback = callback;
    }

    handleModeChange(mode: PermissionMode) {
        this.permissionMode = mode;
        this.session.setPermissionMode(mode);
    }

    /**
     * Handler response
     */
    protected async handlePermissionResponse(
        response: PermissionResponse,
        pending: PendingPermissionRequest<PermissionResult>
    ): Promise<PermissionCompletion> {
        const completion: PermissionCompletion = {
            status: response.approved ? 'approved' : 'denied',
            reason: response.reason,
            mode: response.mode,
            allowTools: response.allowTools,
            answers: response.answers
        };

        // Update allowed tools
        if (response.allowTools && response.allowTools.length > 0) {
            response.allowTools.forEach(tool => {
                if (isQuestionToolName(tool)) {
                    return;
                }
                if (tool.startsWith('Bash(') || tool === 'Bash') {
                    this.parseBashPermission(tool);
                } else {
                    this.allowedTools.add(tool);
                }
            });
        }

        // Update permission mode
        if (response.mode) {
            this.permissionMode = response.mode;
            this.session.setPermissionMode(response.mode);
        }

        // Handle ask_user_question
        if (isAskUserQuestionToolName(pending.toolName)) {
            const answers = response.answers ?? {};
            if (Object.keys(answers).length === 0) {
                pending.resolve({ behavior: 'deny', message: 'No answers were provided.' });
                completion.status = 'denied';
                completion.reason = completion.reason ?? 'No answers were provided.';
            } else {
                pending.resolve({
                    behavior: 'allow',
                    updatedInput: buildAskUserQuestionUpdatedInput(pending.input, answers)
                });
            }
            return completion;
        }

        // Handle request_user_input
        if (isRequestUserInputToolName(pending.toolName)) {
            const answers = response.answers ?? {};
            if (Object.keys(answers).length === 0) {
                pending.resolve({ behavior: 'deny', message: 'No answers were provided.' });
                completion.status = 'denied';
                completion.reason = completion.reason ?? 'No answers were provided.';
            } else {
                pending.resolve({
                    behavior: 'allow',
                    updatedInput: buildRequestUserInputUpdatedInput(pending.input, answers)
                });
            }
            return completion;
        }

        if (pending.toolName === 'exit_plan_mode' || pending.toolName === 'ExitPlanMode') {
            // Handle exit_plan_mode specially
            logger.debug('Plan mode result received', response);
            if (response.approved) {
                logger.debug('Plan approved - injecting PLAN_FAKE_RESTART');
                // Inject the approval message at the beginning of the queue
                if (response.mode && PLAN_EXIT_MODES.includes(response.mode)) {
                    this.session.queue.unshift(PLAN_FAKE_RESTART, { permissionMode: response.mode });
                } else {
                    this.session.queue.unshift(PLAN_FAKE_RESTART, { permissionMode: 'default' });
                }
                pending.resolve({ behavior: 'deny', message: PLAN_FAKE_REJECT });
            } else {
                pending.resolve({ behavior: 'deny', message: response.reason || 'Plan rejected' });
            }
            return completion;
        }

        // Handle default case for all other tools
        const result: PermissionResult = response.approved
            ? {
                behavior: 'allow',
                updatedInput: (pending.input as Record<string, unknown>) || {},
                // 用户选择"本session允许"时，透传 SDK 的权限建议
                ...(response.allowTools && response.allowTools.length > 0 && pending.suggestions
                    ? { updatedPermissions: pending.suggestions as PermissionUpdate[] }
                    : {}),
                decisionClassification: response.allowTools && response.allowTools.length > 0
                    ? 'user_permanent' as PermissionDecisionClassification
                    : 'user_temporary' as PermissionDecisionClassification,
                toolUseID: pending.toolUseID,
            }
            : {
                behavior: 'deny',
                message: response.reason || `The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.`,
                decisionClassification: 'user_reject' as PermissionDecisionClassification,
                toolUseID: pending.toolUseID,
            };

        pending.resolve(result);
        return completion;
    }

    /**
     * Creates the canCallTool callback for the SDK
     */
    handleToolCall = async (toolName: string, input: unknown, options: { signal: AbortSignal; suggestions?: PermissionUpdate[]; toolUseID?: string } & SDKUIHints): Promise<PermissionResult> => {
        const isQuestionTool = isQuestionToolName(toolName);

        // Check if tool is explicitly allowed
        if (!isQuestionTool && toolName === 'Bash') {
            const inputObj = input as { command?: string };
            if (inputObj?.command) {
                // Check literal matches
                if (this.allowedBashLiterals.has(inputObj.command)) {
                    return { behavior: 'allow', updatedInput: input as Record<string, unknown> };
                }
                // Check prefix matches
                for (const prefix of this.allowedBashPrefixes) {
                    if (inputObj.command.startsWith(prefix)) {
                        return { behavior: 'allow', updatedInput: input as Record<string, unknown> };
                    }
                }
            }
        } else if (!isQuestionTool && this.allowedTools.has(toolName)) {
            return { behavior: 'allow', updatedInput: input as Record<string, unknown> };
        }

        //
        // Approval flow
        //

        // [W2a] 观测 SDK suggestions 提供率，为会话白名单简化决策提供数据
        const suggCount = options.suggestions?.length ?? 0
        const suggDest = options.suggestions?.[0]?.destination ?? 'none'
        logger.debug(
            `[permission-stats] tool=${toolName} hasSuggestions=${suggCount > 0} count=${suggCount} dest=${suggDest}`
        )

        // SDK 契约：canUseTool 入参稳定提供 toolUseID（sdk.d.ts:245，非可选）
        const toolCallId = options.toolUseID;
        if (!toolCallId) {
            throw new Error(`SDK did not provide toolUseID for ${toolName}`);
        }
        // 注入 agent 信息到 sdkHints（只拷贝 SDKUIHints 已知字段，排除 signal 等）
        const sdkHints: SDKUIHints = {
            title: options.title,
            displayName: options.displayName,
            description: options.description,
            decisionReason: options.decisionReason,
            blockedPath: options.blockedPath,
            agentID: options.agentID,
        }
        if (options.agentID) {
            const agentInfo = this.agentInfoMap.get(options.agentID)
            if (agentInfo) {
                sdkHints.agentDescription = agentInfo.description
                sdkHints.agentSubagentType = agentInfo.subagentType
            }
        }
        return this.handlePermissionRequest(toolCallId, toolName, input, options.signal, {
            suggestions: options.suggestions,
            toolUseID: options.toolUseID,
            sdkHints,
        });
    }

    /**
     * Handles individual permission requests
     */
    private async handlePermissionRequest(
        id: string,
        toolName: string,
        input: unknown,
        signal: AbortSignal,
        extra?: { suggestions?: PermissionUpdate[]; toolUseID?: string; sdkHints?: SDKUIHints }
    ): Promise<PermissionResult> {
        return new Promise<PermissionResult>((resolve, reject) => {
            // Set up abort signal handling
            const abortHandler = () => {
                this.pendingRequests.delete(id);
                this.finalizeRequest(id);
                reject(new Error('Permission request aborted'));
            };
            signal.addEventListener('abort', abortHandler, { once: true });

            // Store the pending request
            this.addPendingRequest(id, toolName, input, {
                resolve: (result: PermissionResult) => {
                    signal.removeEventListener('abort', abortHandler);
                    resolve(result);
                },
                reject: (error: Error) => {
                    signal.removeEventListener('abort', abortHandler);
                    reject(error);
                }
            }, { suggestions: extra?.suggestions, toolUseID: extra?.toolUseID, sdkHints: extra?.sdkHints });

            logger.debug(`Permission request sent for tool call ${id}: ${toolName}`);
        });
    }


    /**
     * Parses Bash permission strings into literal and prefix sets
     */
    private parseBashPermission(permission: string): void {
        // Ignore plain "Bash"
        if (permission === 'Bash') {
            return;
        }

        // Match Bash(command) or Bash(command:*)
        const bashPattern = /^Bash\((.+?)\)$/;
        const match = permission.match(bashPattern);
        
        if (!match) {
            return;
        }

        const command = match[1];
        
        // Check if it's a prefix pattern (ends with :*)
        if (command.endsWith(':*')) {
            const prefix = command.slice(0, -2); // Remove :*
            this.allowedBashPrefixes.add(prefix);
        } else {
            // Literal match
            this.allowedBashLiterals.add(command);
        }
    }

    /**
     * Handles messages to track agent info（仅保留 task_started；tool_use/tool_result 追踪已移除）
     */
    onMessage(message: SDKMessage): void {
        if (message.type === 'system') {
            const sysMsg = message as SDKTaskStartedMessage;
            if (sysMsg.subtype === 'task_started' && sysMsg.task_id && sysMsg.description) {
                this.agentInfoMap.set(sysMsg.task_id, {
                    description: sysMsg.description,
                    subagentType: sysMsg.subagent_type,
                });
            }
        }
    }

    /**
     * 轮次间重置：清空挂起请求，保留会话级白名单
     */
    resetForNewTurn(): void {
        this.responses.clear();
        this.agentInfoMap.clear();

        this.cancelPendingRequests({
            rejectMessage: 'Turn reset'
        });
    }

    /**
     * Resets all state for new sessions
     */
    reset(): void {
        this.responses.clear();
        this.allowedTools.clear();
        this.allowedBashLiterals.clear();
        this.allowedBashPrefixes.clear();
        this.agentInfoMap.clear();

        this.cancelPendingRequests({
            rejectMessage: 'Session reset'
        });
    }

    /**
     * Gets the responses map (for compatibility with existing code)
     */
    getResponses(): Map<string, PermissionResponse> {
        return this.responses;
    }

    protected handleMissingPendingResponse(_response: PermissionResponse): void {
        logger.debug('Permission request not found or already resolved');
    }

    protected onResponseReceived(response: PermissionResponse): void {
        logger.debug(`Permission response: ${JSON.stringify(response)}`);
        this.responses.set(response.id, { ...response, receivedAt: Date.now() });
        // 重置空闲计时器（权限审批响应）
        this.session.client.resetIdleTimer();
    }

    protected onRequestRegistered(toolCallId: string): void {
        if (this.onPermissionRequestCallback) {
            this.onPermissionRequestCallback(toolCallId);
        }
    }
}
