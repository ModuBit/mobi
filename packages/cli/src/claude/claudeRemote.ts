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

import { randomUUID } from 'node:crypto'
import { EnhancedMode } from "./types";
import {
    startup,
    query,
    type Options,
    type Query,
    type WarmQuery,
    type SDKMessage,
    type SDKSystemMessage,
    type SDKUserMessage,
    type SDKUserMessageReplay,
    type SDKAssistantMessage,
    type SDKPartialAssistantMessage,
    type SDKResultMessage,
    type SDKCompactBoundaryMessage,
    type McpServerConfig,
} from '@anthropic-ai/claude-agent-sdk'
import { claudeCheckSession } from "./utils/claudeCheckSession";
import { join } from 'node:path';
import { parseSpecialCommand, checkDangerousCommand } from "@/parsers/specialCommands";
import { logger, configuration } from "@/lib";
import { PushableAsyncIterable } from "@/utils/PushableAsyncIterable";
import { getProjectPath } from "./utils/path";
import { awaitFileExist } from "@/modules/watcher/awaitFileExist";
import { buildAppendSystemPrompt } from "./utils/systemPrompt";
import type { PermissionResult } from "./sdk/types";
import type { PermissionUpdate } from "@anthropic-ai/claude-agent-sdk";
import type { SDKUIHints } from "@mobi/shared";
import { getClaudeExecutablePath } from "./sdk/claudeExecutable";
import { wrapCommand, cleanupSandbox, spawnWithTimeout } from "@/modules/sandbox/sandboxManager";
import { StreamSnapshotSender, type ContentBlock } from './utils/streamSnapshotSender'
import { AssistantPartialAssembler } from './utils/assistantPartialAssembler'
import { buildClaudeFeatureEnv } from './featureFlags'
import { pushUserMessage } from './utils/pushUserMessage'
import type { PromptPayload } from '@/utils/promptBuilder'
import { StreamUsageCapture, injectUsageFromStream } from './utils/streamUsageCapture'
import { stripBunDebuggerEnv } from '@/utils/spawnMobiCli'

/**
 * 特殊命令处理结果
 */
export type SpecialCommandResult = {
    /** 是否已处理（不需要继续发送给 SDK） */
    handled: boolean
    /** 是否需要退出（如 /clear） */
    shouldExit: boolean
    /** 是否是 /compact 命令 */
    isCompact: boolean
}

/**
 * 特殊命令处理上下文
 */
export type SpecialCommandContext = {
    onClear: () => void
    onCompactStart: () => void
    /** localIds：本批用户消息的 mobi localId，随 !cmd 注入文本一并绑定 native_id */
    executeBash: (cmd: string, localIds: string[]) => Promise<void>
    onReady: () => void
}

/**
 * 创建特殊命令处理上下文
 */
export function createSpecialCommandContext(
    opts: {
        onCompletionEvent?: (message: string) => void
        onContextCleared?: () => void
        onSessionReset?: () => void
        onReady: () => void
    },
    executeBash: (cmd: string, localIds: string[]) => Promise<void>
): SpecialCommandContext {
    return {
        onClear: () => {
            if (opts.onContextCleared) {
                opts.onContextCleared()
            } else {
                opts.onCompletionEvent?.('Context was reset')
            }
            opts.onSessionReset?.()
        },
        onCompactStart: () => {
            opts.onCompletionEvent?.('Compaction started')
        },
        executeBash,
        onReady: opts.onReady,
    }
}

/**
 * 统一处理特殊命令（/clear、/compact、!bash）
 * @param message 用户消息
 * @param context 处理上下文
 * @returns 处理结果
 */
export async function handleSpecialCommand(
    message: string,
    context: SpecialCommandContext,
    localIds: string[] = []
): Promise<SpecialCommandResult> {
    const special = parseSpecialCommand(message)

    // /clear: 重置 session，退出当前循环
    if (special.type === 'clear') {
        context.onClear()
        return { handled: true, shouldExit: true, isCompact: false }
    }

    // /compact: 标记为 compact 命令，继续发送给 SDK
    if (special.type === 'compact') {
        logger.debug('[claudeRemote] /compact command detected')
        context.onCompactStart()
        return { handled: true, shouldExit: false, isCompact: true }
    }

    // !bash: 本地执行，继续等待下一条消息
    if (special.type === 'bash' && special.command) {
        await context.executeBash(special.command, localIds)
        context.onReady()
        return { handled: true, shouldExit: false, isCompact: false }
    }

    // 普通消息，发送给 SDK
    return { handled: false, shouldExit: false, isCompact: false }
}

/** !bash 合成 tool call ID 的前缀 */
const BASH_TOOL_CALL_PREFIX = '!bash_'

// 仅填充 sdkToLogConverter/normalizeAgent 所需的 message.content，其余字段省略
function createBashToolUseMessage(toolCallId: string, command: string): SDKAssistantMessage {
    return {
        type: 'assistant',
        message: {
            role: 'assistant',
            content: [{ type: 'tool_use', id: toolCallId, name: 'Bash', input: { command } }],
        },
        parent_tool_use_id: null,
        session_id: '',
    } as unknown as SDKAssistantMessage
}

// 仅填充 sdkToLogConverter/normalizeAgent 所需的 message.content，其余字段省略
function createBashToolResultMessage(
    toolCallId: string,
    content: string,
    isError: boolean,
): SDKUserMessage {
    return {
        type: 'user',
        message: {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: toolCallId, content, is_error: isError }],
        },
        parent_tool_use_id: null,
        session_id: '',
    } as unknown as SDKUserMessage
}

/**
 * 转义 XML 特殊字符（& < >），避免 bash 输出里的尖括号破坏标签解析。
 * 仅用于注入文本的 stdout/stderr/命令体，标签名本身不转义。
 */
function escapeXml(s: string): string {
    return s.replace(/[&<>]/g, c => c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;')
}

/**
 * 构造「!bash 输出注入 SDK context」的 user 消息文本。
 * 对齐 Claude CLI 的 processBashCommand 原生格式：用模型训练即识别的结构化标签
 * bash-input / bash-stdout / bash-stderr 包裹命令与输出（stdout/stderr 分离、同行），
 * 比自然语言更省 token、解析更稳。CLI 本还在前面加一条 local-command-caveat
 * （「DO NOT respond…」），那是配合 shouldQuery:false 用的——mobi 走 A 路（注入即响应），
 * 故改用一句简短的「已执行、无需重复执行」框定，既防止模型再用 Bash 工具重跑，
 * 又不与「期待模型响应」的语义冲突。
 */
export function buildBashInjectionText(command: string, stdout: string, stderr: string, hasError: boolean): string {
    const status = hasError ? '（执行失败/有错误输出）' : ''
    const out = stdout.trim()
    const err = stderr.trim()
    const stdoutTag = `<bash-stdout>${escapeXml(out)}</bash-stdout>`
    const stderrTag = `<bash-stderr>${escapeXml(err)}</bash-stderr>`
    return [
        `用户在本地用 ! 前缀执行了以下 bash 命令${status}（已执行，无需重复执行）：`,
        `<bash-input>${escapeXml(command)}</bash-input>`,
        `${stdoutTag}${stderrTag}`,
    ].join('\n')
}

/**
 * 对用户消息进行预处理：
 * 将 $...$ 替换为 \(...\)，避免触发 Claude API 的 prompt injection 过滤器。
 * \( ... \) 与 $ ... $ 是等价的 LaTeX 行内公式语法。
 */
export function sanitizeUserMessage(message: string): string {
    // 匹配成对的 $（排除已转义的 \$ 和块级 $$...$$），中间不含换行或另一对 $
    return message.replace(/(?<!\\)\$(?!\$)([^$\n]+?)(?<!\$)\$(?!\$)/g, '\\($1\\)')
}

/** 对双形态 prompt 产物统一做 $...$ → \(...\) 转义：
 *  string 原样转义；数组形态仅对 text 元素的文本逐个应用同一转义，
 *  image 元素（base64 源）原样保留、元素顺序不变——保证「同句正文带图与否」行为一致 */
export const sanitizePayload = (p: PromptPayload): PromptPayload =>
    typeof p === 'string'
        ? sanitizeUserMessage(p)
        : p.map(el => el.type === 'text' ? { ...el, text: sanitizeUserMessage(el.text) } : el)

/** 特殊命令（/clear /compact !bash）只可能出现在 string 形态 payload（命令均以纯文本入队）；
 *  数组 payload 恒为普通消息，返回空串走 handleSpecialCommand 的「普通消息」分支 */
const asCommandText = (p: PromptPayload): string =>
    typeof p === 'string' ? p : ''

/** 判别 isReplay 回显消息（CC 接收确认信号，nativeAckAt 数据源）。
 *  回显 uuid = 当初 push 时预设的 nativeId；launcher onMessage 据此拦截并转 ack 上报。 */
export function isReplayUserMessage(message: SDKMessage): message is SDKUserMessageReplay {
    return message.type === 'user' && (message as SDKUserMessageReplay).isReplay === true
}

/** command_lifecycle 帧 → lifecycle fact 的状态映射。
 *  CC 对排队消息（push 时预设的 command_uuid = nativeId）的生命周期回执：
 *  started → processing、completed → done、cancelled / discarded 直传；
 *  queued 不上报（Hub 已有初始排队态），非法/缺字段返回 null。 */
export function commandLifecycleToFact(
    message: unknown
): { nativeId: string; state: 'processing' | 'done' | 'cancelled' | 'discarded' } | null {
    if (typeof message !== 'object' || message === null) return null
    const m = message as { type?: unknown; command_uuid?: unknown; state?: unknown }
    if (m.type !== 'command_lifecycle') return null
    if (typeof m.command_uuid !== 'string' || m.command_uuid.length === 0) return null
    const s = m.state
    if (s === 'started') return { nativeId: m.command_uuid, state: 'processing' }
    if (s === 'completed') return { nativeId: m.command_uuid, state: 'done' }
    if (s === 'cancelled' || s === 'discarded') return { nativeId: m.command_uuid, state: s }
    return null
}

function resolveResumeSessionId(claudeArgs: string[] | undefined, cwd: string): string | null {
    if (!claudeArgs) return null;

    for (let i = 0; i < claudeArgs.length; i++) {
        if (claudeArgs[i] !== '--resume' && claudeArgs[i] !== '-r') continue;

        const nextArg = claudeArgs[i + 1];
        if (nextArg && !nextArg.startsWith('-') && nextArg.includes('-')) {
            if (claudeCheckSession(nextArg, cwd)) {
                logger.debug(`[claudeRemote] Found --resume with session ID: ${nextArg}`);
                return nextArg;
            }
            logger.debug(`[claudeRemote] Session file not found for ${nextArg}, ignoring --resume`);
            return null;
        }

        logger.debug('[claudeRemote] Found --resume without session ID - not supported in remote mode');
        return null;
    }

    return null;
}

function handleStreamEvent(
    message: SDKPartialAssistantMessage,
    snapshotSender: StreamSnapshotSender,
    fallbackModel?: string,
): void {
    const event = message.event;
    const parentToolUseId = message.parent_tool_use_id;
    const sdkUuid = message.uuid;

    if (event.type === 'message_start') {
        snapshotSender.clearBuffers();
        snapshotSender.setSnapshotOpts({
            parentToolUseId: parentToolUseId || undefined,
            model: event.message.model || fallbackModel,
            sdkUuid,
            // Anthropic 为本条 message 分配的 id：snapshot 写入 message.id，前端 resolveMessageCache
            // 据此精确清理同 id 的 snapshot（取代脆弱的 parentUuid 关联——见 streaming.md 坑 2）。
            // SDKPartialAssistantMessage 的 parent_tool_use_id 总是 null（官方文档），故 snapshot 永远
            // 走主链 lastUuid，而 full 走各自 parent_tool_use_id 路径，parentUuid 必然漂移。
            messageId: event.message.id,
        });
    } else if (event.type === 'message_stop') {
        snapshotSender.flush();
    } else if (event.type === 'content_block_start') {
        // narrow 后 event.index 必为 number
        const block = event.content_block;
        if (block?.type === 'text') {
            snapshotSender.startBlock(event.index, 'text');
        } else if (block?.type === 'thinking') {
            snapshotSender.startBlock(event.index, 'thinking');
        } else if (block?.type === 'tool_use') {
            // tool_use 的 id/name 在 content_block_start 齐全；input 随 input_json_delta 累积，
            // content_block_stop 后随 snapshot 下发 → 前端建 running block（不等 type:'assistant' 完整消息）
            snapshotSender.startBlock(event.index, 'tool_use', { id: block.id, name: block.name });
        }
    } else if (event.type === 'content_block_delta') {
        const delta = event.delta;
        if (delta?.type === 'text_delta') {
            snapshotSender.append(event.index, delta.text);
        } else if (delta?.type === 'thinking_delta') {
            snapshotSender.append(event.index, delta.thinking);
        } else if (delta?.type === 'input_json_delta') {
            // tool_use 的 input 分片流式，累积到完整 JSON（content_block_stop 后才进 snapshot）
            // typeof 校验字段名：SDK 类型对 input_json_delta 未严格导出，防止字段名差异致 undefined 混入
            const chunk = delta.partial_json;
            if (typeof chunk === 'string' && chunk) snapshotSender.append(event.index, chunk);
        }
    } else if (event.type === 'content_block_stop') {
        snapshotSender.endBlock(event.index);
    }
}

/**
 * 将 Promise 与 AbortSignal 竞争，signal abort 时返回 fallback
 */
function abortable<T>(promise: Promise<T>, signal: AbortSignal, fallback: T): Promise<T> {
    if (signal.aborted) return Promise.resolve(fallback)
    return Promise.race([
        promise,
        new Promise<T>((resolve) => {
            signal.addEventListener('abort', () => resolve(fallback), { once: true })
        }),
    ])
}

/**
 * 双循环共享上下文，用于 sdkOutputLoop 和 userInputLoop 之间通信
 */
export interface LoopContext {
    /** 是否为 /compact 命令（sdkOutputLoop 读取后重置） */
    isCompactCommand: boolean
    /**
     * 是否已有输入 push。提前激活（spec 2026-08-28）后 query attach 早于首条消息，
     * 启动 init 不再代表 turn 运行——init 仅在 hasInput 时置 running=true，
     * 否则无 turn 即无 result 复位，web 会永久显示「运行中」。
     */
    hasInput: boolean
    /**
     * 首条消息的模型名（stream_event 缺 model 时 snapshot 标注兜底）。
     * 提前激活后循环先于 initial 启动，构造参数不可得——由 claudeRemote 在
     * initial 处理完成后回填（handleStreamEvent 读取本字段，不再走 opts.initialModel）。
     */
    initialModel?: string
}

/**
 * SDK 输出循环：持续拉取 SDK 消息并分发
 * 不再阻塞等待用户输入，后台任务产生的消息可被即时处理
 */
export async function sdkOutputLoop(
    response: Query,
    ctx: LoopContext,
    opts: {
        path: string
        onMessage: (message: SDKMessage) => void
        snapshotSender: StreamSnapshotSender
        onSessionFound: (id: string) => void
        onReady: () => void
        onRunningChange: (running: boolean) => void
        onCompletionEvent?: (message: string) => void
        /**
         * compact 结束（result 到达）时触发，无论成功失败。
         * 发结构化 compact-completed 事件，作为 web 端退出压缩态的兜底完成信号——
         * 失败路径（如 "Not enough messages to compact."）无 compact_summary，靠此解禁输入。
         */
        onCompactCompleted?: () => void
        /** 中止信号，外部调用 abort() 时停止迭代 */
        signal?: AbortSignal
        /**
         * 迭代结束（含 abort/异常）时若当前 message 的完整 full 未下发且有累积内容，触发补全落库。
         * pending 内容由调用方 convertSnapshot 成 RawJSONLines 后 sendClaudeSessionMessage 下发。
         */
        onAbortFlush?: (pending: { blocks: ContentBlock[]; model?: string; parentToolUseId?: string; messageId?: string }) => void
        /**
         * 上下文用量上报触发（每轮 result 一次，零额外 API）。launcher 从 resultMsg 的
         * usage / modelUsage / total_cost_usd 本地组装 ContextUsage。**不调用** SDK getContextUsage
         * （其内部 count_tokens / Haiku 兜底请求会撑爆限流）。
         *
         * compact 的 result 跳过此回调（其 usage 是「压缩这一步」的调用，不反映压缩后占用），
         * 改由 onCompactBoundary 用 post_tokens 上报压缩后真实占用。
         */
        onContextUsage?: (resultMsg: SDKResultMessage, isCompact: boolean) => void
        /**
         * compact_boundary 到达时触发，携带压缩后 token（compact_metadata.post_tokens）。
         * launcher 用它 + 上次记忆的 maxTokens/costUsd 组装 ContextUsage 上报。
         * post_tokens 为可选字段（失败时缺失）→ 传入 undefined，launcher 保持上一轮读数。
         */
        onCompactBoundary?: (postTokens: number | undefined) => void
    },
): Promise<void> {
    let queryStarted = false;

    // 装配 SDK includePartialMessages 拆分的 assistant partial（同 message.id 的多 block）
    // 为一条完整消息后再分发：snapshot 是 message 级（一条累积所有 block），full 也必须是
    // message 级（一条），二者 1-vs-1 才能让前端 parentUuid 清理可靠（不漂移）。
    // 用 template.uuid（= body.uuid，SDK 分配、写进 .jsonl）作 localId，resume 去重安全；
    // 不复用 sdkUuid——那是 stream_event 的临时 uuid，不在 .jsonl，会破坏 resume。
    // usage 跨通道摆渡：message_start 捕获真实 usage（message_delta 补 output），
    // 装配 flush 时注入——assistant 消息 envelope 的 usage 是 {0,0} 占位，不注入则落库即丢
    const usageCapture = new StreamUsageCapture();
    const assembler = new AssistantPartialAssembler((msg) => {
        // full 下发前注入 thinking 的 durationMs/done：snapshot→full 是替换关系，
        // full 若不重新携带，思考完成后「思考了 X 秒」会在 full 到达时丢失（injectThinkingMeta 按
        // content 数组下标匹配 buffers 中已 done 的 thinking block）
        if (msg.type === 'assistant' && (msg as SDKAssistantMessage).message?.id) {
            opts.snapshotSender.injectThinkingMeta(msg as SDKAssistantMessage);
            injectUsageFromStream(msg as SDKAssistantMessage, usageCapture);
        }
        opts.onMessage(msg);
        // assembler 聚合输出完整 full（同 message.id 的所有 block 拼回一条，带 message.id）→
        // 标记该 message 的 snapshot 已被 full 取代，abort 时 consumePendingFull 不再补全（避免重复）。
        // 守卫 message.id：只对聚合 full（有 id）置位；透传的缺 id assistant（异常路径）不置位，
        // 让 snapshot 补全仍能处理它，避免误跳过导致内容丢失
        if (msg.type === 'assistant' && (msg as SDKAssistantMessage).message?.id) {
            opts.snapshotSender.markFullDelivered();
        }
    });

    for await (const message of response) {
        // 外部中止时立即退出迭代
        if (opts.signal?.aborted) break

        if (!queryStarted) {
            queryStarted = true;
            logger.debug(`[sdkOutputLoop] First message received from SDK: ${message.type}/${('subtype' in message ? (message as { subtype: string }).subtype : '-')}`);
        }
        logger.debugLargeJson(`[sdkOutputLoop] Message ${message.type}`, message);

        // 处理流式事件：累积 delta 到 snapshot sender + 捕获 usage（供装配注入）
        if (message.type === 'stream_event') {
            usageCapture.capture(message);
            handleStreamEvent(message, opts.snapshotSender, ctx.initialModel);
            continue;
        }

        // 收到完整 assistant 消息时刷新快照（snapshot 通道：发当前累积的预览）
        if (message.type === 'assistant') {
            opts.snapshotSender.flush();
        }

        // 分发消息（assistant 经 assembler 聚合成一条，非 assistant 透传并触发上一个 message flush）
        assembler.submit(message);

        // 处理 system/init 消息
        if (message.type === 'system' && message.subtype === 'init') {
            // 提前激活：attach 早于首条消息，启动 init 不代表 turn 运行（见 LoopContext.hasInput）
            if (ctx.hasInput) {
                opts.onRunningChange(true);
            }

            const systemInit = message as SDKSystemMessage;

            // 等待 session 文件写入磁盘
            if (systemInit.session_id) {
                logger.debug(`[sdkOutputLoop] Waiting for session file: ${systemInit.session_id}`);
                const projectDir = getProjectPath(opts.path);
                const found = await awaitFileExist(join(projectDir, `${systemInit.session_id}.jsonl`));
                logger.debug(`[sdkOutputLoop] Session file found: ${systemInit.session_id} ${found}`);
                opts.onSessionFound(systemInit.session_id);
            }
        }

        // 处理 compact_boundary：提取压缩后 token，上报压缩后真实占用。
        // 压缩这一步的 result.usage 不反映压缩后占用（见下方 result 处理跳过），故从此消息取
        // post_tokens。microcompact_boundary 无 post_tokens，不在此处理（保持现状）。
        if (message.type === 'system' && message.subtype === 'compact_boundary') {
            const meta = (message as SDKCompactBoundaryMessage).compact_metadata;
            const postTokens = typeof meta?.post_tokens === 'number' ? meta.post_tokens : undefined;
            opts.onCompactBoundary?.(postTokens);
        }

        // conversation_reset【不处理】：sdk.d.ts 明确其由 /clear、plan-mode exit、fresh-session
        // 三种流触发且消息本身无法区分——若据此清空水位，用户退出 plan 模式（mobi 常见路径：
        // ExitPlanMode 批准后直切）会误清 contextUsage 与 launcher 记忆。mobi /clear 走
        // specialCommand 路径（handleSpecialCommand → onClear）已正确清空，此处不重复挂接。

        // 处理 result 消息：不阻塞，直接继续拉取后台消息
        if (message.type === 'result') {
            opts.onRunningChange(false);
            const { terminal_reason } = message as SDKResultMessage;
            const isInterrupt = terminal_reason === 'aborted_streaming' || terminal_reason === 'aborted_tools';

            if (isInterrupt) {
                logger.debug('[sdkOutputLoop] Interrupted');
            } else {
                logger.debug('[sdkOutputLoop] Result received');
            }

            // 读取并重置 isCompactCommand：发结构化完成事件，web 据此退出压缩态（成功失败都发）
            const wasCompact = ctx.isCompactCommand
            if (ctx.isCompactCommand) {
                logger.debug('[sdkOutputLoop] Compaction completed');
                opts.onCompactCompleted?.();
                ctx.isCompactCommand = false;
            }

            // 通知就绪
            opts.onReady();

            // 上下文用量上报：launcher 从 resultMsg 本地组装。
            // - 中断（aborted_*）：turn 未完成，usage 可能缺失/不完整，跳过，UI 保留上一轮读数。
            // - compact：用量由 compact_boundary 的 post_tokens 上报（见 onCompactBoundary），此处
            //   仍回调（isCompact=true）让 launcher 回填累计成本（compact 的 total_cost_usd），
            //   避免连续 /compact 期间 lastCostUsd 冻结。
            if (!isInterrupt) {
                opts.onContextUsage?.(message as SDKResultMessage, wasCompact);
            }
        }
    }

    // 迭代结束：snapshot 补全优先于 assembler flush，避免重复落库。
    // - 有 pending（assembler 未聚合输出完整 full，即 markFullDelivered 未置位）：用 snapshotSender
    //   的累积（stream_event 实时累积，最完整）走 onAbortFlush 补全；assembler 的 pending 是不完整
    //   partial，丢弃（不调 assembler.flush），避免与 snapshot 补全重复落库。
    // - 无 pending（full 已 delivered）：assembler.flush 输出最后一条 message 的完整聚合 full。
    //   （assistant 经 assembler 在中途遇不同 message.id / 非 assistant 时已 flush；这里兜底最后一条）
    const pendingFull = opts.snapshotSender.consumePendingFull();
    if (pendingFull) {
        opts.onAbortFlush?.(pendingFull);
    } else {
        assembler.flushAll();
    }

    logger.debug(`[sdkOutputLoop] Response iteration ended normally. queryStarted=${queryStarted}`);
}

/**
 * 用户输入循环：独立等待用户消息并推送到 PushableAsyncIterable
 * 与 sdkOutputLoop 并行运行，互不阻塞
 */
export async function userInputLoop(
    messages: PushableAsyncIterable<SDKUserMessage>,
    ctx: LoopContext,
    opts: {
        nextMessage: () => Promise<{ message: PromptPayload, mode: EnhancedMode, localIds: string[] } | null>
        specialCommandCtx: SpecialCommandContext
        /** 中止信号，外部调用 abort() 时退出循环 */
        signal?: AbortSignal
        /** agent 是否正在运行（门控：运行时暂缓拉消息） */
        isRunning?: () => boolean
        /** 等待 agent 闲置（running 翻 false / result 时 resolve） */
        waitForIdle?: () => Promise<void>
        /** 用户消息 push 给 SDK 后上报 (localIds → nativeId) 绑定 */
        onBound?: (binding: { localIds: string[]; nativeId: string }) => void
        /** 输入 push 前回调：置 LoopContext.hasInput 并立即置 running（提前激活后 init 不再驱动 running） */
        markInputPushed: () => void
    },
): Promise<void> {
    while (!opts.signal?.aborted) {
        // 门控：agent 在跑就先等到 result（idle）；agent 闲置时直接拉
        if (opts.isRunning?.()) {
            const waitIdle = opts.waitForIdle ?? (() => Promise.resolve())
            if (opts.signal) {
                await abortable(waitIdle(), opts.signal, undefined)
            } else {
                await waitIdle()
            }
            // abort 后立即退出
            if (opts.signal?.aborted) { messages.end(); return }
        }

        // 将 nextMessage 与 abort 信号竞争，避免 sdkOutputLoop 结束后永远挂起
        const next = await (opts.signal
            ? abortable(opts.nextMessage(), opts.signal, null)
            : opts.nextMessage()
        )

        // null 或已中止 → 结束
        if (!next || opts.signal?.aborted) {
            messages.end();
            return;
        }

        const result = await handleSpecialCommand(asCommandText(next.message), opts.specialCommandCtx, next.localIds);

        // 需要退出（如 /clear）
        if (result.shouldExit) {
            messages.end();
            return;
        }

        // /compact 命令：设置标记并继续发送给 SDK
        if (result.isCompact) {
            ctx.isCompactCommand = true;
        }

        // 已处理但非 compact（即 bash），继续等待下一条
        if (result.handled && !result.isCompact) {
            continue;
        }

        // 普通消息或 compact，推送到 messages（预设 uuid 并上报 localIds → nativeId 绑定）
        opts.markInputPushed();
        pushUserMessage(messages, sanitizePayload(next.message), { localIds: next.localIds, onBound: opts.onBound });
    }
}

export async function claudeRemote(opts: {

    // Fixed parameters
    sessionId: string | null,
    path: string,
    /**
     * rewind 截断轮保留锚（锚点用户消息前最近一条 assistant entry uuid）：
     * 携带时本轮为截断轮——startup 预热 boot 时按 resume 加载历史到锚点即截断，
     * 截断确认后经 onRewindTruncated 回报（先截断后软删除），再等用户消息
     */
    resumeSessionAt?: string,
    /** rewind 截断完成后（startup 预热 boot 加载历史到锚点）立即回调，做两段回报 */
    onRewindTruncated?: () => Promise<void>,
    mcpServers?: Record<string, McpServerConfig>,
    claudeEnvVars?: Record<string, string>,
    claudeArgs?: string[],
    allowedTools: string[],
    hookSettingsPath: string,
    /** 项目冻结的额外工作目录（创建时来自项目 folders，resume 时回放 metadata） */
    additionalDirectories?: string[],
    getSessionConfig: () => EnhancedMode,
    flushConfig?: () => void,
    canCallTool: (toolName: string, input: unknown, options: { signal: AbortSignal; suggestions?: PermissionUpdate[]; toolUseID?: string } & SDKUIHints) => Promise<PermissionResult>,

    // Dynamic parameters
    nextMessage: () => Promise<{ message: PromptPayload, mode: EnhancedMode, localIds: string[] } | null>,
    /** 用户消息 push 给 SDK 后上报 (localIds → nativeId) 绑定 */
    onMessagesBound: (bindings: { localId: string; nativeId: string }[]) => void,
    onReady: () => void,

    // Callbacks
    onSessionFound: (id: string) => void,
    onRunningChange?: (running: boolean) => void,
    onMessage: (message: SDKMessage) => void,
    onSnapshot: (msg: import('@mobi/shared').DecryptedMessage) => void,
    /** Snapshot converter，用于生成与最终消息一致的 DecryptedMessage */
    getConverter: () => import('./utils/sdkToLogConverter').SDKToLogConverter,
    onCompletionEvent?: (message: string) => void,
    /** compact 结束（result）时触发，发结构化完成事件给 web 作压缩态退出信号（成功失败都发） */
    onCompactCompleted?: () => void,
    onContextCleared?: () => void,
    /** 流式期间 abort/中断时，把已累积但 full 未到的内容补全落库（由 launcher 实现 convert+send） */
    onAbortFlush?: (pending: { blocks: ContentBlock[]; model?: string; parentToolUseId?: string; messageId?: string }) => void,
    onSessionReset?: () => void,
    /** 上下文用量上报触发（result 时；launcher 从 resultMsg 本地组装，零额外 API）。
     * isCompact=true 表示这是 compact 的 result：用量改由 compact_boundary 上报，launcher 只回填成本 */
    onContextUsage?: (resultMsg: SDKResultMessage, isCompact: boolean) => void,
    /** compact_boundary 到达：post_tokens 为压缩后 token（失败时 undefined），launcher 据此上报压缩后占用 */
    onCompactBoundary?: (postTokens: number | undefined) => void,
    // Query 就绪回调，用于外部获取 Query 引用（interrupt/close）
    onQueryReady?: (query: Query) => void,
    // steer sink 就绪回调：传入把文本 push 进 SDK input stream 的方法，用于 steer 已排队消息
    // push 携带可选 localId：steal 路径的消息同样预设 uuid 并上报绑定
    onSteerSinkReady?: (push: (payload: PromptPayload, localId?: string) => boolean) => void,
    /** UserPromptSubmit hook 观测回调：入站 prompt（含跨会话 peer 消息）直达 wrapper，
     * 由 launcher 甄别落库。恒同步调用、不阻塞 SDK 主流程（回调内部自行兜错） */
    onInboundPrompt?: (input: { prompt: string; source?: string }) => void,
}) {

    // pushUserMessage 的绑定回调适配：localIds 批展开为逐条 (localId, nativeId) 上报
    const onBound = (binding: { localIds: string[]; nativeId: string }) => {
        opts.onMessagesBound(binding.localIds.map(localId => ({ localId, nativeId: binding.nativeId })))
    }

    // Check if session is valid
    let startFrom = opts.sessionId;
    if (opts.sessionId && !claudeCheckSession(opts.sessionId, opts.path)) {
        startFrom = null;
    }

    if (!startFrom) {
        startFrom = resolveResumeSessionId(opts.claudeArgs, opts.path);
    }

    // Set environment variables for Claude Code SDK
    if (opts.claudeEnvVars) {
        Object.entries(opts.claudeEnvVars).forEach(([key, value]) => {
            process.env[key] = value;
        });
    }
    process.env.DISABLE_AUTOUPDATER = '1';

    // 清理 IDE 调试器环境变量，避免 SDK spawn 的 claude 子进程继承后冲突
    stripBunDebuggerEnv(process.env as Record<string, string | undefined>);

    // 预生成 nativeSessionId，让上游（metadata）立即可用
    // SDK 支持 Options.sessionId 指定自定义 session ID
    const pregeneratedSessionId = !startFrom ? randomUUID() : undefined
    if (pregeneratedSessionId) {
        logger.debug(`[claudeRemote] Pregenerated session ID: ${pregeneratedSessionId}`)
        opts.onSessionFound(pregeneratedSessionId)
    }

    // !bash 输出注入 sink：把「命令+输出」作为隐藏 user 消息 push 进 SDK input stream。
    // 在 messages + query 就绪后（下方 wiring）才接通；接通前为 null，
    // 故「首条消息即 !cmd」（query 尚未启动，函数会在 handleSpecialCommand 后 return）时不注入，
    // 退化为纯本地执行——符合预期。注入消息不调 onMessage，SDK 也不回放 user 文本，UI 看不到。
    let bashInjectSink: ((text: string, localIds?: string[]) => boolean) | null = null

    // !bash: 本地执行 shell 命令，不走 SDK，生成 tool_use/tool_result 消息对。
    // localIds：触发本条 !cmd 的用户消息批 localId，注入时绑定到注入消息的 native_id
    const executeBashCommand = async (command: string, localIds: string[] = []): Promise<void> => {
        logger.debug(`[claudeRemote] Bash command detected: ${command}`)

        const toolCallId = `${BASH_TOOL_CALL_PREFIX}${randomUUID()}`

        // 高危命令拦截
        const dangerCheck = checkDangerousCommand(command)
        if (dangerCheck.isDangerous) {
            logger.warn(`[claudeRemote] Dangerous command blocked: ${command} (${dangerCheck.reason})`)
            opts.onMessage(createBashToolUseMessage(toolCallId, command))
            opts.onMessage(createBashToolResultMessage(
                toolCallId,
                `⚠ 命令已拦截：${dangerCheck.reason}`,
                true,
            ))
            return
        }

        opts.onRunningChange?.(true)
        opts.onMessage(createBashToolUseMessage(toolCallId, command))

        // 在用户工作目录下执行命令（沙箱隔离 + 超时控制）
        let stdout = ''
        let stderr: string
        let hasError = false
        try {
            const sandboxedCommand = await wrapCommand(command)
            const result = await spawnWithTimeout(sandboxedCommand, {
                cwd: opts.path,
                timeout: 30000,
            })
            stdout = result.stdout
            stderr = result.stderr
            if (result.timedOut) {
                hasError = true
                stderr += (stderr ? '\n' : '') + '命令执行超时（30s）'
            }
        } catch (error) {
            hasError = true
            stderr = error instanceof Error ? error.message : String(error)
        } finally {
            cleanupSandbox()
        }

        const output = stdout && stderr
            ? `${stdout}\n${stderr}`
            : stdout || stderr

        opts.onMessage(createBashToolResultMessage(toolCallId, output, hasError))

        // 注入输出到 SDK context（默认开启，settings.json 的 bashInjectContext 可关）。
        // 模型据此感知并响应；注入本身不回显（见 sink 注释）。高危拦截路径已 return，不会走到这。
        // sink 未接通（首条消息即 !cmd，query 未启动）时 push 无意义，按未注入处理。
        // 注入文本不经 sanitizeUserMessage：它是 XML 标签包裹的结构化命令/输出（非用户自由文本），
        // LaTeX 化 $…$→\(…\) 会把 bash 输出里的货币/数学串（如 $5$）篡改成 \(5\)，让模型读到错误数据。
        // sink 返回 push 是否被接纳，据此判断注入是否真的会触发模型轮次。
        const injected = configuration.bashInjectContext && Boolean(bashInjectSink)
        const turnStarted = injected
            ? bashInjectSink!(buildBashInjectionText(command, stdout, stderr, hasError), localIds)
            : false

        // running 复位策略：
        // - turnStarted（push 被活着的 messages 接纳 → 必触发模型轮次）：由 SDK 的 system/init→result
        //   驱动复位，不在此手动复位——否则「复位 false」会先于异步「init true」落地，制造 running=false
        //   窗口，userInputLoop 的 idle 门控可能在窗口内误放行下一条用户消息，导致 turn 串扰。
        // - !turnStarted（注入关 / sink 未接通 / messages 已关闭不会触发轮次）：必须手动复位，
        //   否则 running 永久卡 true（query 退出后 push 被丢弃即此情形）。
        if (!turnStarted) {
            opts.onRunningChange?.(false)
        }
    }

    // 预热子进程；常规轮 startup 成功即「提前激活」（spec 2026-08-28 ①）——不等首条消息
    // 就 attach query 并启动输出循环，跨会话等 SDK 旁路流量从会话第一秒起被消费落库。
    // 首条消息的消费路径（nextMessage → handleSpecialCommand → push）原样后移，语义零变化。
    let warmRef: WarmQuery | null = null

    const baseConfig = opts.getSessionConfig()
    // 先解析 claude 可执行路径（dev 模式返回 undefined，由 SDK 自动 require.resolve）
    const claudeExecutable = await getClaudeExecutablePath()
    const sdkOptions: Options = {
        cwd: opts.path,
        // 开启后 SDK 会把同一 Anthropic message 的多个 content block 作为独立的
        // SDKAssistantMessage emit（共享 message.id、各自独立 uuid——SDK 文档明确行为）。
        // mobi 直接透传每条消息、用各自 uuid 作 localId，Hub 去重天然正确；前端
        // resolveMessageCache 按 parentUuid 清理 snapshot，不依赖 full.id == snapshot.id。
        includePartialMessages: true,
        agentProgressSummaries: true,
        // 开启后 SDK 每轮 result 后 emit 一条 prompt_suggestion（预测的下一轮用户 prompt）。
        // mobi 分类器已把 prompt_suggestion 归为 ephemeral（落 DB + SSE 实时推 + 历史过滤），
        // sdkToLogConverter default 分支透传——只需开此 option，后续链路即通。
        promptSuggestions: true,
        resume: startFrom ?? undefined,
        // rewind 截断：resume 时只加载到该 uuid（锚点前最近一条 assistant message）为止。
        // 与 resume 配合由 startup 预热在 boot 时生效，不走空 prompt——空 prompt 会被
        // 模型当成「空消息」触发一轮无意义回复。此处仅在 rewind 轮有值，其余轮 undefined。
        resumeSessionAt: opts.resumeSessionAt,
        sessionId: pregeneratedSessionId,
        mcpServers: opts.mcpServers,
        permissionMode: baseConfig.permissionMode,
        model: baseConfig.model,
        // effort 依赖 thinking 默认值 { type: 'adaptive' } 才能生效，SDK 默认即为 adaptive
        effort: baseConfig.effort,
        fallbackModel: baseConfig.fallbackModel,
        // systemPrompt 统一走 preset + append：customSystemPrompt 与 appendSystemPrompt
        // 都作为追加内容拼在 claude_code 默认 prompt 之后（详见 buildAppendSystemPrompt），
        // 不再用纯字符串整体替换——那会丢掉 claude_code 默认 prompt。
        systemPrompt: {
            type: 'preset' as const,
            preset: 'claude_code' as const,
            append: buildAppendSystemPrompt(baseConfig),
        },
        // rewind 文件回滚依赖 file checkpoint（Query.rewindFiles 的前置条件，
        // SDK 类型注明 "Requires file checkpointing to be enabled"）
        enableFileCheckpointing: true,
        // isReplay 回显：CC 把 stdin 用户消息回显（带预设 uuid），CLI 拦截后作接收确认
        // （nativeAckAt 数据源，rewind 锚点可靠性）。必须与 launcher onMessage 拦截同一 PR 上线，
        // 否则回显会重复落库。
        extraArgs: { 'replay-user-messages': null },
        allowedTools: baseConfig.allowedTools ? baseConfig.allowedTools.concat(opts.allowedTools) : opts.allowedTools,
        disallowedTools: baseConfig.disallowedTools,
        // web 工具替换（常驻注入）：模型 emit WebSearch/WebFetch → 执行层重定向到 mobi-web in-process 工具。
        // 无可用 provider 时 handler 返回明确错误（国内环境内置本就不可用，无回退损失）。
        toolAliases: {
            WebSearch: 'mcp__mobi-web__web_search',
            WebFetch: 'mcp__mobi-web__web_fetch',
        },
        canUseTool: async (toolName, input, options) => {
            const result = await opts.canCallTool(toolName, input, options);
            return result;
        },
        pathToClaudeCodeExecutable: claudeExecutable,
        settings: opts.hookSettingsPath,
        // env 会整体替换子进程环境（不与 process.env 合并），故必须自行展开，
        // 否则 PATH / HOME / ANTHROPIC_API_KEY 等继承变量会丢失
        env: { ...process.env, ...buildClaudeFeatureEnv() } as Record<string, string>,
        // .mobi 目录（附件访问）+ 项目冻结的额外工作目录（创建时来自项目 folders，resume 时回放）
        additionalDirectories: [join(opts.path, '.mobi'), ...(opts.additionalDirectories ?? [])],
        toolConfig: {
            askUserQuestion: { previewFormat: 'markdown' }
        },
        // 入站跨会话消息观测（spec 2026-08-28 ②）：SDK 进程内 hook 回调，
        // 事件直达 wrapper——无需 shell 命令/端口/token（与 settings 文件的
        // SessionStart hook-forwarder 并存不冲突）。只观测不干预，恒放行。
        hooks: {
            UserPromptSubmit: [{
                hooks: [async (input) => {
                    if (input.hook_event_name === 'UserPromptSubmit') {
                        opts.onInboundPrompt?.({ prompt: input.prompt, source: input.source })
                    }
                    return { continue: true }
                }],
            }],
        },
    }

    // running 跟踪 + idle gate（先于 messages/bashInjectSink 声明，消除 TDZ 阅读歧义）：
    // running 翻 false（result）时 resolve，供 userInputLoop 等待
    // 保证消息只在 agent 闲置时才被拉取并推送，避免 turn 串扰
    let running = false;
    let idleResolver: (() => void) | null = null
    const waitForIdle = (): Promise<void> =>
        new Promise<void>(resolve => { idleResolver = resolve })
    const resolveIdle = (): void => {
        const r = idleResolver
        idleResolver = null
        r?.()
    }

    const updateRunning = (newRunning: boolean) => {
        if (running !== newRunning) {
            running = newRunning;
            logger.debug(`[claudeRemote] Running state changed to: ${running}`);
            // result → 放行 userInputLoop 门控
            if (!newRunning) resolveIdle()
            if (opts.onRunningChange) {
                opts.onRunningChange(running);
            }
        }
    };

    // 双循环共享上下文：hasInput 门控 init→running；initialModel 由 initial 处理后回填
    const loopCtx: LoopContext = { isCompactCommand: false, hasInput: false }

    /** 输入 push 统一前置：标记已有输入并立即置 running（提前激活后 init 不再驱动 running） */
    const markInputPushed = (): void => {
        loopCtx.hasInput = true
        updateRunning(true)
    }

    // 创建 messages 并接通 !bash 注入 sink：提前激活时随 attach 一同接通。query 尚未启动，
    // PushableAsyncIterable 会缓冲，query 消费时即触发模型响应。
    const messages = new PushableAsyncIterable<SDKUserMessage>();
    // 返回 push 是否被接纳：messages 已关闭（query 退出）时 push 会抛错，捕获返回 false，
    // 供 executeBashCommand 判断「注入不会触发模型轮次」并据此复位 running。
    bashInjectSink = (text: string, localIds: string[] = []): boolean => {
        if (messages.done) return false;
        try {
            markInputPushed();
            pushUserMessage(messages, text, { localIds, onBound });
            return true;
        } catch {
            return false;
        }
    };

    // 双循环协调：任一退出时 abort 通知另一个终止（提前激活窗口内输出循环的 signal
    // 已被引用，声明须先于 outputLoopPromise 创建）
    const loopAbort = new AbortController()

    // —— attach 产物：提前激活 / fallback attach / finally 清理三方共享，统一声明
    let warmConsumed = false
    let response: Query | null = null
    let snapshotSender: StreamSnapshotSender | null = null
    let outputLoopError: unknown = null
    let outputLoopPromise: Promise<void> | null = null

    /** attach 完成后启动流式快照发送器与输出循环（提前激活与 fallback attach 共用） */
    const startOutputLoop = (q: Query): void => {
        // 流式输出：Snapshot 发送器
        snapshotSender = new StreamSnapshotSender(
            opts.onSnapshot,
            opts.getConverter(),
        );
        snapshotSender.start();
        outputLoopPromise = sdkOutputLoop(q, loopCtx, {
            path: opts.path,
            onMessage: opts.onMessage,
            onAbortFlush: opts.onAbortFlush,
            snapshotSender,
            onSessionFound: opts.onSessionFound,
            onReady: opts.onReady,
            onRunningChange: updateRunning,
            onCompletionEvent: opts.onCompletionEvent,
            onCompactCompleted: opts.onCompactCompleted,
            onContextUsage: opts.onContextUsage,
            onCompactBoundary: opts.onCompactBoundary,
            signal: loopAbort.signal,
        }).catch((e) => { outputLoopError = e })
        // 防首条消息等待窗口的未处理 rejection：race 接管前先挂 no-op catch
        outputLoopPromise.catch(() => {})
    }

    // 下面的 early return（等不到首条消息 / 首条特殊命令退出 / 首条 !bash 注入关）
    // 都可能发生在提前激活之后——统一由 finally 清理 attach 产物（abort 输出循环、
    // 关闭 query、销毁 snapshotSender、复位 running、未消费的 warm 补关）。
    try {
        // rewind 截断由 startup 预热承载：sdkOptions 已带 resumeSessionAt（resume 时只加载到
        // 锚点 uuid 为止），startup 在 boot 时加载历史即完成截断。
        let initial: { message: PromptPayload; mode: EnhancedMode; localIds: string[] };
        if (opts.resumeSessionAt) {
            // 截断轮：串行 startup 截断 → 回报 → 等用户消息。回报必须落在 nextMessage 之前——
            // 用户消息依赖 Web 回填（rewind-completed），回填依赖回报，若等 nextMessage 再回报会死锁。
            // 截断轮不提前激活（截断本身就是要丢历史，窗口内无旁路流量价值），行为与现状一致。
            // startup 失败（进程 spawn 失败）向上抛，由 launcher catch 补发 completed { error }
            warmRef = await startup({ options: sdkOptions })
            await opts.onRewindTruncated?.()
            const msg = await opts.nextMessage()
            if (!msg) {
                return
            }
            initial = msg
        } else {
            // 常规轮：预热；startup 失败不提前激活，回落现状路径（首条消息到了再 fallback attach），
            // 不新增失败分支（spec 约束）
            try {
                warmRef = await startup({ options: sdkOptions })
            } catch (e) {
                logger.debug(`[claudeRemote] startup failed, deferring attach to first message:`, e)
            }
            if (warmRef) {
                // 提前激活核心（spec 2026-08-28 ①）：不等首条消息即 attach + 启动输出循环，
                // 首条消息等待窗口内的旁路流量（跨会话等 SDK 注入）被即时消费落库
                response = warmRef.query(messages)
                warmConsumed = true
                // 把 Query 引用传给外部，用于 interrupt/close 控制
                opts.onQueryReady?.(response);
                startOutputLoop(response)
            }
            const msg = await opts.nextMessage()
            if (!msg) {
                return
            }
            initial = msg
        }

        const specialCommandCtx = createSpecialCommandContext(opts, executeBashCommand)
        const initialResult = await handleSpecialCommand(asCommandText(initial.message), specialCommandCtx, initial.localIds)

        if (initialResult.shouldExit) {
            return
        }

        // 首条即 bash：注入开 → 注入已入 messages、由已启动的循环消费触发模型轮次；注入关 → 纯本地、退出。
        const isBashInitial = initialResult.handled && !initialResult.isCompact
        if (isBashInitial && !configuration.bashInjectContext) {
            return
        }

        loopCtx.isCompactCommand = initialResult.isCompact;

        if (!warmConsumed) {
            // fallback attach（startup 失败路径，行为同现状）：首条消息到了再 attach
            const fallbackConfig = opts.getSessionConfig()
            const fallbackOptions: Options = {
                ...sdkOptions,
                permissionMode: fallbackConfig.permissionMode,
                model: fallbackConfig.model,
                effort: fallbackConfig.effort,
            }
            response = query({ prompt: messages, options: fallbackOptions })
            // 把 Query 引用传给外部，用于 interrupt/close 控制
            opts.onQueryReady?.(response);
            startOutputLoop(response)
        }

        // initial 处理完成，回填模型名（stream_event 缺 model 时的快照兜底，见 LoopContext.initialModel）
        loopCtx.initialModel = initial.mode.model

        // 注入 steer sink：把仍排队的消息 payload push 进 SDK input stream，返回 true。
        // 由 launcher 的 steer-queued-message RPC 调用，把已排队消息提前提交给 SDK。
        // localId 携带时同样预设 uuid 并上报绑定（steal 路径单条消息）。
        if (opts.onSteerSinkReady) {
            opts.onSteerSinkReady((payload: PromptPayload, localId?: string) => {
                try {
                    markInputPushed();
                    pushUserMessage(messages, sanitizePayload(payload), { localIds: localId ? [localId] : [], onBound });
                    return true;
                } catch (e) {
                    logger.debug('[claudeRemote] steer push 失败，消息将 pushBack 恢复排队:', e);
                    return false;
                }
            });
        }

        // Push initial message
        // 首条即 bash 且注入开时，executeBashCommand 已把注入 push 进 messages，不再 push 原始 !cmd 文本；
        // 其余（普通消息 / compact）push 原文（预设 uuid 并上报 localIds → nativeId 绑定）。
        if (!isBashInitial) {
            markInputPushed();
            pushUserMessage(messages, sanitizePayload(initial.message), { localIds: initial.localIds, onBound });
        }

        // —— 输入循环：initial 已被外层消费，此刻才安全启动（避免双消费者竞争绕过特殊命令处理）；
        // 输出循环已在提前激活 / fallback attach 时启动
        const inputLoopPromise = userInputLoop(messages, loopCtx, {
            nextMessage: opts.nextMessage,
            specialCommandCtx,
            isRunning: () => running,
            waitForIdle,
            onBound,
            markInputPushed,
            signal: loopAbort.signal,
        })

        await Promise.race([outputLoopPromise!, inputLoopPromise])
        if (outputLoopError !== null) throw outputLoopError
    } catch (e) {
        // 增强错误日志：捕获 SDK 抛出的非标准错误对象。
        // 保持 debug 级：此处 re-throw，错误最终由 claudeRemoteLauncher 的终态 catch
        // 以 error 级落盘（含 SDK 自带的 stderr tail）；这里提级会与 launcher 双写。
        const errorInfo = e instanceof Error
            ? { name: e.name, message: e.message, stack: e.stack?.substring(0, 500) }
            : { type: typeof e, value: String(e), keys: typeof e === 'object' && e !== null ? Object.keys(e) : [] };
        logger.debug(`[claudeRemote] Error iterating response:`, errorInfo);
        throw e;
    } finally {
        // 通知未退出的循环终止
        loopAbort.abort()
        // 关闭 SDK 输出，确保 sdkOutputLoop 停止迭代
        if (response) {
            try { response.close() } catch (e) {
                logger.debug(`[claudeRemote] Error closing response:`, e)
            }
        }
        // snapshotSender 仅在 startOutputLoop 闭包内赋值，TS 流分析在此收窄为 never，显式还原
        (snapshotSender as StreamSnapshotSender | null)?.destroy();
        updateRunning(false);
        if (!warmConsumed) warmRef?.close();
    }
}
