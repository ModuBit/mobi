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
import type { PermissionUpdate as MobiPermissionUpdate, SDKUIHints } from "@mobi/shared";
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
    /** @deprecated 权限范围改由 updatedPermissions 表达，保留作后退字段 */
    allowTools?: string[];
    answers?: Record<string, string | string[]> | Record<string, { answers: string[] }>;
    /** Web 回传的持久化放行建议，透传进 PermissionResult 让 SDK 持久化 */
    updatedPermissions?: MobiPermissionUpdate[];
    receivedAt?: number;
    /** @deprecated 未使用，权限范围由 updatedPermissions 和 mode 决定 */
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
            answers: response.answers,
            updatedPermissions: response.updatedPermissions
        };

        // [持久化兜底] SDK updatedPermissions 经 E2E 验证不跨 turn 持久（SDK 未兑现 session 级放行承诺，
        // 下次同命令仍会调 canCallTool）。故 mobi 自有 Set 兜底：把 Web 选中档的 rules 填进 Set，
        // handleToolCall 命中 Set 直接放行，真正跨 turn 持久（resetForNewTurn 不清 Set）。
        // updatedPermissions 仍透传给 SDK 作双轨兜底（见下方 result.updatedPermissions）。
        if (response.updatedPermissions && response.updatedPermissions.length > 0) {
            for (const update of response.updatedPermissions) {
                if (update.type !== 'addRules' && update.type !== 'replaceRules') continue;
                for (const rule of update.rules) {
                    if (isQuestionToolName(rule.toolName)) continue;
                    if (rule.toolName === 'Bash' && rule.ruleContent) {
                        // 复用 parseBashPermission：ruleContent 形如 'echo:*'（前缀）或 'echo hi'（字面）
                        this.parseBashPermission(`Bash(${rule.ruleContent})`);
                    } else {
                        this.allowedTools.add(rule.toolName);
                    }
                }
            }
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
        // 按 Web 回传的 updatedPermissions 决定：有则作为持久化放行建议透传给 SDK（user_permanent），
        // 无则仅本次放行（user_temporary），不写 updatedPermissions
        const hasUpdatedPermissions = !!response.updatedPermissions && response.updatedPermissions.length > 0;
        const result: PermissionResult = response.approved
            ? {
                behavior: 'allow',
                updatedInput: (pending.input as Record<string, unknown>) || {},
                ...(hasUpdatedPermissions
                    ? { updatedPermissions: response.updatedPermissions as PermissionUpdate[] }
                    : {}),
                decisionClassification: hasUpdatedPermissions
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

        // 防御性诊断：acceptEdits/bypassPermissions 模式下 canUseTool 理论上不被 SDK 调用
        // （SDK 自行放行编辑/全部工具）。若被调用，说明 SDK 行为与文档不符，记 warn 便于排查
        if (this.permissionMode === 'acceptEdits' || this.permissionMode === 'bypassPermissions') {
            logger.debug(`[permission][WARN] canUseTool invoked in ${this.permissionMode} mode for ${toolName}; SDK should have auto-handled`);
        }

        //
        // Approval flow
        //

        // [W2a] 观测 SDK suggestions 提供率，为会话白名单简化决策提供数据
        const suggestions = options.suggestions ?? []
        const dests = suggestions.length > 0 ? suggestions.map(s => s.destination).join(',') : 'none'
        logger.debug(
            `[permission-stats] tool=${toolName} count=${suggestions.length} dests=${dests}`
        )

        // SDK 契约：canUseTool 入参稳定提供 toolUseID（sdk.d.ts:245，非可选）
        // 防御：若 SDK 边缘场景未提供，deny 该工具而非抛错中断整个流程
        const toolCallId = options.toolUseID;
        if (!toolCallId) {
            logger.debug(`[permission][ERROR] SDK did not provide toolUseID for ${toolName}, denying`);
            return {
                behavior: 'deny',
                message: `Cannot authorize ${toolName}: missing toolUseID from SDK`
            };
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
