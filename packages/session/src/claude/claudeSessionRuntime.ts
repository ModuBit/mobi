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

import type { SDKMessage, SDKAssistantMessage } from '@anthropic-ai/claude-agent-sdk'
import { classifyMessage } from '@mobi/shared'
import type { ClaudePermissionMode } from '@mobi/shared/types'
import { SDKToLogConverter } from './utils/sdkToLogConverter'
import { OutgoingMessageQueue } from './utils/OutgoingMessageQueue'
import { StreamSnapshotSender, type SnapshotOut } from './utils/streamSnapshotSender'
import type { RawJSONLines } from './types'

/** 权限审批回执（permissionHandler 的 PermissionResponse 结构子集——回填落库所需字段） */
type PermissionApproval = {
    receivedAt?: number
    approved: boolean
    mode?: ClaudePermissionMode
    allowTools?: string[]
}

/** 落库行的权限回填形状（user tool_result 的 permissions 字段，web 端审批徽标数据源） */
type PermissionsField = {
    date: number
    result: 'approved' | 'denied'
    mode?: ClaudePermissionMode
    allowedTools?: string[]
}

export type SessionStreamRuntimeOptions = {
    /** converter 构造种子（ConversionContext 除 parentUuid 外的字段） */
    context: { sessionId: string; cwd: string; version?: string }
    /** 权限审批回执的活引用（converter 的 responses 与权限回填共用同一 Map 实例，
     *  permissionHandler 在原位增删——两处消费始终同视图） */
    permissionResponses: Map<string, PermissionApproval>
    /** 落库发送通道（经 apiSession 的 sendClaudeSessionMessage 咽喉） */
    send: (logMessage: RawJSONLines) => void
}

export type StreamDispatchHooks = {
    /** 轮次变更观测（投影口径数据源），失败不影响主流程 */
    observeTurnDiff: (logMessage: RawJSONLines) => void
    /** result 帧的停止/撤回语义处理（launcher 侧状态：pendingAbortInfo 注入、撤回抑制）。
     *  返回 true = 抑制本条（不转发 daemon 不落库）；正常/非中断 result 在内部清标志 */
    consumeResultFlags: (logMessage: RawJSONLines) => boolean
    /** result 行入列后触发轮次变更合成（卡片必须排在 result 之后，见 dispatch 尾注释） */
    onResultEnqueued: (logMessage: RawJSONLines) => void
}

/**
 * 空壳 result：CC 对「被合并掉」的唤醒（典型：同批多条 task-notification 各自唤醒、
 * 实际合并进一个回合执行）逐条发出的零信息回执——num_turns=0、无文本、无错误、
 * 无终止原因、零 API 用量。落库后 web 会按普通 turn-result 渲染成只剩「42ms + 时间」
 * 的幽灵轮次行（2026-10-31 实证：三条后台任务同时完成 → 两条空壳混进消息流）。
 *
 * 谓词 fail-safe：任一字段缺失或命中「有信息」形态（fork code-review 报告、compact
 * 提示等零回合但带文本的行）都返回 false 保留落库——误杀真 result 的代价远高于漏放空壳。
 * 注意只看 duration_api_ms：空壳的 duration_ms（墙钟）非零。
 */
export function isEmptyShellResult(logMessage: RawJSONLines): boolean {
    // RawJSONLines 的 TS union 未收编 result 变体（schema 历史缺口），与 dispatch 同款
    // 宽化读取；字段形状以落库行实证为准（CC 原样透传 SDK result 字段）
    if ((logMessage as { type?: string }).type !== 'result') return false
    const m = logMessage as {
        num_turns?: number
        result?: string
        is_error?: boolean
        stop_reason?: string | null
        terminal_reason?: string | null
        duration_api_ms?: number
        usage?: { output_tokens?: number } | null
    }
    return (
        m.num_turns === 0 &&
        !m.result &&
        m.is_error === false &&
        m.duration_api_ms === 0 &&
        !m.stop_reason &&
        !m.terminal_reason &&
        m.usage?.output_tokens === 0
    )
}

/**
 * 会话流装配 module（深化候选④票③）：转换链的单一归属。
 *
 * converter（SDK 消息 → 落库行）、出站排队（OutgoingMessageQueue 的 tool_use 配对延迟与
 * FIFO 仲裁）、流式快照发送器工厂三件在此构造——此前分散在 launcher（converter/queue）
 * 与 claudeRemote 闭包（snapshot sender），「convert → enqueue → 合成触发」的顺序契约
 * 靠跨文件时序注释维持。launcher 只做拦截与编排（onMessage 前段），运行层经依赖注入消费。
 */
export class SessionStreamRuntime {
    readonly converter: SDKToLogConverter
    readonly queue: OutgoingMessageQueue<RawJSONLines>
    private readonly permissionResponses: Map<string, PermissionApproval>

    constructor(opts: SessionStreamRuntimeOptions) {
        this.permissionResponses = opts.permissionResponses
        this.converter = new SDKToLogConverter(opts.context, opts.permissionResponses)
        this.queue = new OutgoingMessageQueue(opts.send)
    }

    /** 每轮 query 的流式快照发送器（构造归转换链一处；start/destroy 生命周期由运行层驱动） */
    createSnapshotSender(onSnapshot: (out: SnapshotOut) => void): StreamSnapshotSender {
        return new StreamSnapshotSender(onSnapshot, this.converter)
    }

    /**
     * 转换尾段：observe → discard 过滤 → result 空壳过滤 → result 语义钩子 →
     * 权限回填写入 → tool_use 延迟排队 → 入列 → result 合成触发。
     *
     * 「result 先入列再触发合成」两行顺序不可换（FIFO 时间线顺序）：非 git 投影口径的
     * 合成是同步快路径（无 await），先触发会让卡片抢先注册进队列；撤回路径
     * （consumeResultFlags 返回 true 提前 return）不触发——被撤回 turn 的变更已随撤回
     * 回滚，出卡反而是噪音。顺序契约由 claudeSessionRuntime.test.ts 锁定。
     */
    dispatch(logMessage: RawJSONLines, message: SDKMessage, hooks: StreamDispatchHooks): void {
        hooks.observeTurnDiff(logMessage)

        // 过滤 discard 类消息，不发送到 daemon。上游过滤（提前剪掉，不占队列槽位、
        // 不触发 tool_use hold）；下游兜底在 sessionChannel.sendClaudeSessionMessage——
        // 咽喉点才是 invariant 保证（local scanner 等旁路不经此处），两处规则同源 classifyMessage
        if (classifyMessage(logMessage.type, (logMessage as { subtype?: string }).subtype) === 'discard') {
            return
        }

        // result 帧：中断处理（撤回抑制 / stopKind 注入）与标志清理归 launcher 停止语义。
        // 空壳 result 在标志消费「之前」剪掉：撤回抑制 / pendingAbortInfo 只应绑在
        // 会被转发的行上——空壳若先行消费标志，真中断回执会被漏抑制 / 丢 stopKind
        if ((logMessage as { type?: string }).type === 'result') {
            if (isEmptyShellResult(logMessage)) return
            if (hooks.consumeResultFlags(logMessage)) return
        }

        this.backfillPermissions(logMessage)

        // tool_use 延迟路径已自行入列（等配对）；否则统一入列。result 先入列再触发合成：
        // 两行顺序不可换（见方法注释）
        if (!this.tryEnqueueWithToolCallHold(logMessage, message)) {
            this.queue.enqueue(logMessage)
        }
        if ((logMessage as { type?: string }).type === 'result') {
            hooks.onResultEnqueued(logMessage)
        }
    }

    /** 审批回填写入落库行：user tool_result 携带该 tool_use 的审批结果（web 审批徽标） */
    private backfillPermissions(logMessage: RawJSONLines): void {
        if (logMessage.type === 'user' && logMessage.message?.content) {
            const content = Array.isArray(logMessage.message.content)
                ? logMessage.message.content
                : [];

            for (let i = 0; i < content.length; i++) {
                const c = content[i];
                if (c.type === 'tool_result' && c.tool_use_id) {
                    const response = this.permissionResponses.get(c.tool_use_id);

                    if (response) {
                        const permissions: PermissionsField = {
                            date: response.receivedAt || Date.now(),
                            result: response.approved ? 'approved' : 'denied'
                        };

                        if (response.mode) {
                            permissions.mode = response.mode;
                        }

                        if (response.allowTools && response.allowTools.length > 0) {
                            permissions.allowedTools = response.allowTools;
                        }

                        content[i] = {
                            ...c,
                            permissions
                        };
                    }
                }
            }
        }
    }

    /** 主线 assistant 带 tool_use 时延迟 250ms 入列：等 tool_result 配对到达，
     *  避免 daemon/web 收到悬空工具行（结果到达时 releaseToolCall 提前放行）。
     *  返回是否走了延迟路径（true = 已入列，调用方不再统一入列） */
    private tryEnqueueWithToolCallHold(logMessage: RawJSONLines, message: SDKMessage): boolean {
        if (logMessage.type === 'assistant' && message.type === 'assistant') {
            const assistantMsg = message as SDKAssistantMessage;
            const toolCallIds: string[] = [];

            if (assistantMsg.message.content && Array.isArray(assistantMsg.message.content)) {
                for (const block of assistantMsg.message.content) {
                    if (block.type === 'tool_use' && block.id) {
                        toolCallIds.push(block.id);
                    }
                }
            }

            if (toolCallIds.length > 0) {
                const isSidechain = assistantMsg.parent_tool_use_id !== undefined;

                if (!isSidechain) {
                    this.queue.enqueue(logMessage, {
                        delay: 250,
                        toolCallIds
                    });
                    return true;
                }
            }
        }
        return false;
    }
}
