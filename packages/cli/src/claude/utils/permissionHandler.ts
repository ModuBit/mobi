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
import type { ElicitationRequest, ElicitationResult, SDKMessage, SDKTaskStartedMessage } from "@anthropic-ai/claude-agent-sdk";
import type { PermissionResult, PermissionUpdate, PermissionDecisionClassification } from "../sdk/types";
import type { PermissionAnswers, PermissionUpdate as MobiPermissionUpdate, SDKUIHints } from "@mobi/shared";
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
    answers?: PermissionAnswers;
    /** Web 回传的持久化放行建议，透传进 PermissionResult 让 SDK 持久化 */
    updatedPermissions?: MobiPermissionUpdate[];
    receivedAt?: number;
    /** @deprecated 未使用，权限范围由 updatedPermissions 和 mode 决定 */
    decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort';
}

const PLAN_EXIT_MODES: PermissionMode[] = ['auto', 'default', 'acceptEdits', 'bypassPermissions'];

function isAskUserQuestionToolName(toolName: string): boolean {
    return toolName === 'AskUserQuestion' || toolName === 'ask_user_question';
}

function isRequestUserInputToolName(toolName: string): boolean {
    return toolName === 'RequestUserInput' || toolName === 'request_user_input';
}

function isQuestionToolName(toolName: string): boolean {
    return isAskUserQuestionToolName(toolName) || isRequestUserInputToolName(toolName);
}

function buildAskUserQuestionUpdatedInput(input: unknown, answers: PermissionAnswers): Record<string, unknown> {
    // 归一化为 flat 格式并转为 SDK 要求的 string value
    const sdkAnswers: Record<string, string> = {};
    for (const [key, value] of Object.entries(answers)) {
        let flat: string[];
        if (typeof value === 'string') {
            flat = [value];
        } else if (typeof value === 'number' || typeof value === 'boolean') {
            // elicitation 表单值（批次 C 放宽，spec D3）：AskUserQuestion 场景 SDK 仍要求 string，转字符串
            flat = [String(value)];
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

/** MCP elicitation 走审批链路的合成 toolName（spec D1）——web 端按此名分流表单卡片 */
export const ELICITATION_TOOL_NAME = 'mcp_elicitation';

/**
 * requestedSchema 最小合法性：object + properties（MCP elicitation 仅允许 primitive/enum 字段）。
 * schema 缺失/形态不对视为 malformed，直接 decline 并留 cli 日志（spec D4）。
 */
function isValidElicitationSchema(schema: unknown): schema is Record<string, unknown> {
    return isObject(schema)
        && (schema as { type?: unknown }).type === 'object'
        && isObject((schema as { properties?: unknown }).properties);
}

/**
 * answers → ElicitResult.content：按 requestedSchema.properties 逐字段转型（spec D3）。
 * required 字段缺失或值类型无法转型返回 null（调用方转 decline）。
 * 非 required 字段缺省跳过；转型失败（如 number 列收到非数值串）按字段缺失处理。
 * schema 外的 answers 字段不进 content（防注入未知键）；嵌套 { answers: string[] } 格式
 * 是 request_user_input 专用，elicitation 表单不产生，按缺失处理。
 * 纯函数：rpc 'permission' 通道无 zod 运行时校验，required/类型检查由本函数承担。
 */
export function coerceElicitationContent(
    answers: PermissionAnswers,
    requestedSchema: Record<string, unknown>,
): Record<string, unknown> | null {
    const properties = requestedSchema.properties as Record<string, Record<string, unknown>>;
    const required = Array.isArray(requestedSchema.required) ? (requestedSchema.required as unknown[]) : [];
    const raw = (answers ?? {}) as Record<string, unknown>;
    const content: Record<string, unknown> = {};

    for (const [key, fieldSchema] of Object.entries(properties)) {
        let value: unknown = raw[key];
        // 嵌套格式（request_user_input 专用）不是合法的 elicitation 表单值
        if (isObject(value) && 'answers' in value) value = undefined;

        const coerced = coerceFieldValue(value, fieldSchema);
        if (coerced === undefined) {
            if (required.includes(key)) return null;
            continue;
        }
        content[key] = coerced;
    }
    return content;
}

/**
 * 按 JSON Schema type 转型单值（不含 enum 处理）。
 * integer 与 number 同走数值转型，integer 额外要求整数值。
 * 无 type（enum-only 字段）时调用方应跳过此函数直接做成员校验。
 */
function coerceByType(value: unknown, type: string): unknown {
    if (typeof value === 'string') {
        if (type === 'string') return value;
        if (type === 'number' || type === 'integer') {
            const n = Number(value);
            if (!Number.isFinite(n)) return undefined;
            if (type === 'integer' && !Number.isInteger(n)) return undefined;
            return n;
        }
        if (type === 'boolean') {
            if (value === 'true') return true;
            if (value === 'false') return false;
            return undefined;
        }
        return undefined;
    }
    if (typeof value === 'number') {
        if (type === 'number' || type === 'integer') {
            if (type === 'integer' && !Number.isInteger(value)) return undefined;
            return value;
        }
        if (type === 'string') return String(value);
        return undefined;
    }
    if (typeof value === 'boolean') {
        if (type === 'boolean') return value;
        if (type === 'string') return String(value);
        return undefined;
    }
    return undefined;
}

/**
 * 单字段转型：合法值返回转型结果，缺失/无法转型/enum 非成员返回 undefined（按字段缺失处理）。
 * enum 字段：先按 type 转型（无 type 则原样取值），再校验成员资格——
 * rpc 'permission' 通道无 zod 校验，enum 成员检查由本函数承担（防注入 enum 外的值）。
 */
function coerceFieldValue(value: unknown, fieldSchema: Record<string, unknown>): unknown {
    if (Array.isArray(fieldSchema.enum)) {
        const type = typeof fieldSchema.type === 'string' ? fieldSchema.type : null;
        const coerced = type ? coerceByType(value, type) : value;
        if (coerced === undefined) return undefined;
        return fieldSchema.enum.includes(coerced) ? coerced : undefined;
    }
    if (typeof fieldSchema.type === 'string') {
        return coerceByType(value, fieldSchema.type);
    }
    return undefined;
}

export class PermissionHandler extends BasePermissionHandler<PermissionResponse, PermissionResult> {
    private responses = new Map<string, PermissionResponse>();
    private session: Session;
    private allowedTools = new Set<string>();
    private allowedBashLiterals = new Set<string>();
    private allowedBashPrefixes = new Set<string>();
    private onPermissionRequestCallback?: (toolCallId: string) => void;
    /**
     * mode 变更时通知运行中的 SDK Query 动态切换 permissionMode。
     *
     * session.setPermissionMode 只更新 Session 内存字段（供 keepAlive 上报与 Query 重启时
     * getSessionConfig 读取）；运行中 Query 的模式切换只能靠 query.setPermissionMode。
     * 缺了这条通知，ExitPlanMode 批准选 auto 后 SDK Query 仍停留在旧模式 → 编辑继续弹审批。
     */
    private readonly onApplyPermissionMode?: (mode: PermissionMode) => void | Promise<void>;
    /** agentID → { description, subagentType }，从 task_started 系统消息中提取 */
    private agentInfoMap = new Map<string, { description: string; subagentType?: string }>();

    constructor(session: Session, opts?: { onApplyPermissionMode?: (mode: PermissionMode) => void | Promise<void> }) {
        super(session.client);
        this.session = session;
        this.onApplyPermissionMode = opts?.onApplyPermissionMode;
    }
    
    /**
     * Set callback to trigger when permission request is made
     */
    setOnPermissionRequest(callback: (toolCallId: string) => void) {
        this.onPermissionRequestCallback = callback;
    }

    /**
     * 权限模式变更：写入 session（唯一真相源，心跳/审批判断都从 session 读）。
     * 调用方：web 切换（set-session-config → syncSessionModes）与 plan 流程。
     * 同步入口：内部走 applyModeChange 并兜错——调用方（claudeRemoteLauncher）不
     * await，错误必须在此内部兜住，避免 UnhandledPromiseRejection。
     */
    handleModeChange(mode: PermissionMode) {
        void this.applyModeChange(mode);
    }

    /**
     * mode 变更的完整落地：写 session + 通知运行中 Query 切换（query.setPermissionMode）。
     * 错误吞 + 记 warn（Query 已终止/销毁时可能 reject）。
     * await 版供 handlePermissionResponse 在 resolve 放行前调用——保证 SDK 拿到
     * allow 时 permissionMode 已切换，消除「批准计划但 SDK 仍处 plan 模式」的竞态。
     */
    private async applyModeChange(mode: PermissionMode): Promise<void> {
        this.session.setPermissionMode(mode);
        try {
            await this.onApplyPermissionMode?.(mode);
        } catch (err) {
            logger.warn(`[permission] 切换运行中 Query permissionMode → ${mode} 失败`, err);
        }
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
        // 下次同命令仍会调 canCallTool）。故 mobi 自有 Set 兜底，按 SDK suggestion 做前缀匹配：
        // - addRules/replaceRules：用 ruleContent 填 Set（SDK 给的命令前缀如 'echo:*' 或字面）
        // - suggestion 不可用（updatedPermissions 全是 addDirectories/setMode 等非 rules 类操作）：
        //   回退到 pending.input.command 命令字面填 Set，让「本次会话允许」对同命令生效
        // 不回退的情况：updatedPermissions 含 rules 类操作（addRules/replaceRules/removeRules），
        //   即使未填进 Set（如 Bash 无 ruleContent、removeRules 移除语义），也不应字面兜底——
        //   否则会把「移除/无规则」反转为「会话放行」，与用户选择的语义相反
        // updatedPermissions 仍透传给 SDK 作双轨兜底（见下方 result.updatedPermissions）。
        if (response.updatedPermissions && response.updatedPermissions.length > 0) {
            let hasRulesOp = false;
            for (const update of response.updatedPermissions) {
                if (update.type === 'addRules' || update.type === 'replaceRules' || update.type === 'removeRules') {
                    hasRulesOp = true;
                }
                if (update.type !== 'addRules' && update.type !== 'replaceRules') continue;
                for (const rule of update.rules) {
                    if (isQuestionToolName(rule.toolName)) continue;
                    if (rule.toolName === 'Bash' && rule.ruleContent) {
                        // 复用 parseBashPermission：ruleContent 形如 'echo:*'（前缀）或 'echo hi'（字面）
                        this.parseBashPermission(`Bash(${rule.ruleContent})`);
                    } else if (rule.toolName === 'Bash') {
                        // Bash 无 ruleContent：mobi 命令级粒度无法放行裸 'Bash'（且 handleToolCall 不查
                        // allowedTools 查 Bash），跳过不填，避免语义混乱
                    } else {
                        this.allowedTools.add(rule.toolName);
                    }
                }
            }
            // 仅当 updatedPermissions 全是 addDirectories/setMode 等非 rules 类操作时回退命令字面
            if (!hasRulesOp && pending.toolName === 'Bash') {
                const cmd = (pending.input as { command?: string } | null)?.command;
                if (cmd) this.parseBashPermission(`Bash(${cmd})`);
            }
        }

        // MCP elicitation（批次 C）：approved + answers → 放行原始 answers 给 handleElicitation
        // 转型（转型单点位在该处，spec D3）；拒绝 → decline。注意 elicitation 的 accept 不走
        // 下方通用 allow 分支（没有 updatedInput / updatedPermissions 语义）
        if (pending.toolName === ELICITATION_TOOL_NAME) {
            pending.resolve({ approved: response.approved, answers: response.answers } as unknown as PermissionResult);
            return completion;
        }

        // Update permission mode
        if (response.mode) {
            // 通知运行中的 SDK Query 动态切换（ExitPlanMode 批准 / 普通工具批准带 mode 都走这里）。
            // session 字段供 keepAlive 上报与 Query 重启时 getSessionConfig 读取；运行中 Query 的
            // 模式切换只能靠 query.setPermissionMode，不能只写 session——否则 plan 批准选 auto 后
            // SDK 仍停留在旧模式，编辑继续走 canUseTool 弹审批。
            await this.applyModeChange(response.mode);
        }

        // Handle ask_user_question
        if (isAskUserQuestionToolName(pending.toolName)) {
            // 「聊一聊」：用户带 reason（seed 文案）拒绝 → 透传成 deny message，
            // 引导 Claude 主动反问而非给出 dead-end "No answers were provided."。
            // 对齐 Claude Code CLI 的 Chat about this。
            const reason = response.reason?.trim()
            if (reason) {
                pending.resolve({ behavior: 'deny', message: reason });
                completion.status = 'denied';
                completion.reason = reason;
                return completion;
            }

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
                // 批准计划：直接 allow，SDK 在同一 turn 继续执行计划（对齐 Claude Code TUI 原生行为）。
                // permissionMode 切换由上方通用 response.mode 分支承担（session 写入 + query.setPermissionMode）；
                // 无/非法 mode 时此处兜底 default——计划批准后不应停留在 plan 模式。
                // （旧实现为 deny + PLAN_FAKE_REJECT/PLAN_FAKE_RESTART 注入重启，SDK 支持运行时
                //  切换 permissionMode 后已拆除，enter_plan_mode 进入路径本就走 setPermissionMode）
                const targetMode = response.mode && PLAN_EXIT_MODES.includes(response.mode)
                    ? response.mode
                    : 'default';
                if (targetMode !== response.mode) {
                    // 无/非法 mode 的兜底路径：await 完成切换（写 session + query.setPermissionMode）
                    // 再 resolve 放行——SDK 在同一 turn 开始执行计划中的 Write/Edit 时，
                    // permissionMode 必须已生效，否则会撞上 plan 模式本不该出现的审批/拒绝
                    await this.applyModeChange(targetMode);
                }
                pending.resolve({
                    behavior: 'allow',
                    updatedInput: (pending.input as Record<string, unknown>) || {},
                    decisionClassification: 'user_temporary' as PermissionDecisionClassification,
                    toolUseID: pending.toolUseID,
                });
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
        // 模式从 session 读（唯一真相源）：web 切换写入 session，此处立即感知
        const currentPermissionMode = this.session.getPermissionMode();
        if (currentPermissionMode === 'acceptEdits' || currentPermissionMode === 'bypassPermissions') {
            logger.debug(`[permission][WARN] canUseTool invoked in ${currentPermissionMode} mode for ${toolName}; SDK should have auto-handled`);
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
     * MCP elicitation 受理（批次 C，spec D1/D2）：form 模式构造 pending 走审批链路，
     * url 模式 decline 兜底（授权链路归 pending #63）。pending id 用 control_request
     * envelope 的 requestId（web 提交时原样回传，闭环匹配）。
     * pendingRequests 的 reject（turn 重置/会话重置/abort）统一转 { action: 'cancel' }，
     * 不向 SDK 抛异常（SDK 契约：意外异常/null = 不回包，挂到 server 超时）。
     */
    handleElicitation = async (
        request: ElicitationRequest,
        options: { signal: AbortSignal; requestId: string },
    ): Promise<ElicitationResult | null> => {
        // url 授权模式本批不做（spec D2）
        if (request.mode === 'url') return { action: 'decline' };
        if (!isValidElicitationSchema(request.requestedSchema)) {
            logger.warn(`[elicitation] malformed requestedSchema from ${request.serverName}, declining`);
            return { action: 'decline' };
        }
        try {
            // elicitation 响应的转型单点位（spec D3）：本 promise resolve 的
            // { approved, answers } 由 handlePermissionResponse elicitation 分支放行
            const outcome = await new Promise<{ approved: boolean; answers?: PermissionAnswers }>((resolve, reject) => {
                // abort（SDK 侧 elicitation 完成/会话关闭等）→ 清 pending + 移除 agentState 卡片
                // （spec D5「已决即消失」，对齐 handlePermissionRequest 既有模式），reject 转 cancel
                const abortHandler = () => {
                    this.pendingRequests.delete(options.requestId);
                    this.finalizeRequest(options.requestId);
                    reject(new Error('elicitation aborted'));
                };
                options.signal.addEventListener('abort', abortHandler, { once: true });
                this.addPendingRequest(
                    options.requestId,
                    ELICITATION_TOOL_NAME,
                    { serverName: request.serverName, message: request.message, requestedSchema: request.requestedSchema },
                    {
                        resolve: (value) => {
                            options.signal.removeEventListener('abort', abortHandler);
                            resolve(value as unknown as { approved: boolean; answers?: PermissionAnswers });
                        },
                        reject: (error: Error) => {
                            options.signal.removeEventListener('abort', abortHandler);
                            reject(error);
                        }
                    },
                    { sdkHints: { title: request.title, displayName: request.displayName, description: request.description } },
                );
            });
            if (!outcome.approved) return { action: 'decline' };
            const content = coerceElicitationContent(outcome.answers ?? {}, request.requestedSchema);
            if (!content) return { action: 'decline' };
            // coerceElicitationContent 只产 string/number/boolean 原始值，满足 ElicitResult.content 的 primitive map 契约
            return { action: 'accept', content: content as NonNullable<ElicitationResult['content']> };
        } catch {
            return { action: 'cancel' };
        }
    };

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
