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
 * Schema validates fields used in the codebase and keeps explicit
 * log fields required by the CLI and UI.
 */

import { z } from "zod";
import type { RewindFilesResult } from "@anthropic-ai/claude-agent-sdk";
import type { ClaudePermissionMode, EffortLevel } from "@mobi/shared/types";

// UsageSchema 已下沉 @mobi/shared/schemas（ticket-12，node-core api/types 共用），此处 re-export 保调用方零改动
export { UsageSchema } from '@mobi/shared/schemas'
import { UsageSchema } from '@mobi/shared/schemas'
import { TRANSCRIPT_TAP_ATTACHMENT_VALIDATORS } from '@mobi/shared/transcriptTap'

const RawMessageSchema = z.object({
  role: z.string().optional(),
  content: z.unknown(),
  usage: UsageSchema.optional(),
});

const RawJSONLinesBaseSchema = z.object({
  uuid: z.string().optional(),
  parentUuid: z.string().nullable().optional(),
  parent_tool_use_id: z.string().nullable().optional(),
  session_id: z.string().optional(),
  isSidechain: z.boolean().optional(),
  isMeta: z.boolean().optional(),
  isCompactSummary: z.boolean().optional(),
  userType: z.string().optional(),
  cwd: z.string().optional(),
  sessionId: z.string().optional(),
  version: z.string().optional(),
  gitBranch: z.string().optional(),
  timestamp: z.string().optional(),
});

/**
 * attachment 载荷注册白名单（mods-goal-channel 票 02）：按 name（载荷自身的 type 字段）
 * 经 shared 校验注册表（TRANSCRIPT_TAP_ATTACHMENT_VALIDATORS）分发校验——本文件
 * 零业务语义，坏载荷校验失败走管道既有静默跳过；**未注册 name 也静默跳过**
 * （注册即「持久化 + 广播」白名单：tap 只认注册类型，未注册行本就无人消费，
 * 放行会让未知类型从「管道跳过」变「落库 + 全端广播」，广播面无界）。
 * 已注册类型的额外字段仅被校验视角 strip，不影响原始行透传
 * （union 层 .loose() + unknown 载荷逐字节保留）。
 */
const AttachmentPayloadSchema = z.unknown().superRefine((val, ctx) => {
  if (!val || typeof val !== 'object') return;
  const name = (val as { type?: unknown }).type;
  if (typeof name !== 'string') return;
  const validator = TRANSCRIPT_TAP_ATTACHMENT_VALIDATORS[name];
  if (!validator || validator(val) === false) {
    ctx.addIssue({ code: 'custom', message: `unregistered or invalid attachment payload: ${name}` });
  }
});

// Main schema with validation for the fields used in the app
// Each variant 使用 .loose() 保留未显式定义的 SDK 字段
export const RawJSONLinesSchema = z.discriminatedUnion("type", [
  // User message - validates uuid and message.content
  RawJSONLinesBaseSchema.extend({
    type: z.literal("user"),
    uuid: z.string(),
    message: RawMessageSchema,
    mode: z.string().optional(),
    toolUseResult: z.unknown().optional(),
  }).loose(),

  // Assistant message - only validates uuid and type
  // message object is optional to handle synthetic error messages
  RawJSONLinesBaseSchema.extend({
    uuid: z.string(),
    type: z.literal("assistant"),
    message: RawMessageSchema.optional(),
    requestId: z.string().optional(),
  }).loose(),

  // Summary message - validates summary and leafUuid
  RawJSONLinesBaseSchema.extend({
    type: z.literal("summary"),
    summary: z.string(),
    leafUuid: z.string(),
  }).loose(),

  // System message - validates uuid and subtype data used by the UI
  RawJSONLinesBaseSchema.extend({
    type: z.literal("system"),
    uuid: z.string(),
    subtype: z.string().optional(),
    model: z.string().optional(),
    tools: z.array(z.string()).optional(),
    retryAttempt: z.number().optional(),
    maxRetries: z.number().optional(),
    error: z.unknown().optional(),
    durationMs: z.number().optional(),
  }).loose(),

  // Goal progress — CLI 自产合成消息（每 turn 一次），进聊天流作标注（旧链路，票 05 退役）
  RawJSONLinesBaseSchema.extend({
    type: z.literal("goal_progress"),
    uuid: z.string(),
    met: z.boolean(),
    condition: z.string(),
    reason: z.string().optional(),
    iterations: z.number().optional(),
    durationMs: z.number().optional(),
    tokens: z.number().optional(),
  }).loose(),

  // transcript attachment 行（Claude Code 每 turn 落盘的 goal_status 等）：
  // 载荷注册白名单见 AttachmentPayloadSchema——原始行逐字节透传，管道不做 goal 语义转换
  RawJSONLinesBaseSchema.extend({
    type: z.literal("attachment"),
    uuid: z.string(),
    attachment: AttachmentPayloadSchema,
  }).loose(),
]);

export type RawJSONLines = z.infer<typeof RawJSONLinesSchema>;

// ============ 会话模式相关类型（从 loop.ts 抽出，消除循环依赖）============
// 抽出原因：session/claudeRemote/claudeRemoteLauncher/permissionHandler/runClaude
// 从 loop.ts 反向 import 这些类型，与 loop→下游 的正向调用互引成环（7 条）。
// 下沉到本文件后，下游改从 ./types import，loop 不再被反向引用，环断开。
// 详见 docs/temp/lint-audit-report.md §九 P3

// claude 模块权限模式别名（绑定 Claude；保留可演化性：未来支持 non-claude agent 时分化）
export type PermissionMode = ClaudePermissionMode

/** SDK Query 动态控制引用，用于 setModel/setPermissionMode/applyFlagSettings/rewindFiles */
export type QueryControlRef = {
  current: {
    setPermissionMode: (m: PermissionMode) => Promise<void>
    setModel: (m?: string) => Promise<void>
    applyFlagSettings: (settings: Record<string, unknown>) => Promise<void>
    /** rewind 文件回滚（需运行中的 Query 句柄，RPC 到 claude 进程读 file checkpoint） */
    rewindFiles: (userMessageId: string, options?: { dryRun?: boolean }) => Promise<RewindFilesResult>
  } | null
}

/**
 * rewind 待执行状态：rewind RPC handler 写（受理成功时）、launcher while 循环读
 * （下轮以 resumeSessionAt 截断重启）——挂载在 Session 对象上是因为 launcher 与
 * runClaude 共享同一 Session 实例（loop 创建、onSessionReady 回填 currentSessionRef），
 * 无需引入模块级全局状态。文件回滚在 RPC 受理阶段（截断前）已完成，此处只携带结果
 * 供终态回报（rewind-completed 的 filesRestored / error）。
 */
export type PendingRewind = {
  /** rewind 目标用户消息的 native uuid（transcript 锚点） */
  nativeId: string
  /** resumeSessionAt 保留锚（锚点前最近一条 assistant entry uuid），截断重启用 */
  resumeAt: string
  /** 文件是否已在受理阶段回滚成功（截断前执行——截断后 checkpoint 作废，PoC poc8 实测） */
  filesRestored: boolean
  /** 被安全护栏跳过的文件数（spec E2）；来自 rewindFiles 结果 */
  skippedLinks?: number
}

export interface EnhancedMode {
  permissionMode: PermissionMode;
  model?: string;
  effort?: EffortLevel;
  fallbackModel?: string;
  customSystemPrompt?: string;
  appendSystemPrompt?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
}
