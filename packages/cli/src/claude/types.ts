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
import type { ClaudePermissionMode, EffortLevel } from "@mobi/shared/types";

// Usage statistics for assistant messages - used in apiSession.ts
export const UsageSchema = z.object({
  input_tokens: z.number().int().nonnegative(),
  cache_creation_input_tokens: z.number().int().nonnegative().nullable().optional(),
  cache_read_input_tokens: z.number().int().nonnegative().nullable().optional(),
  output_tokens: z.number().int().nonnegative(),
  service_tier: z.string().nullable().optional(),
});

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
]);

export type RawJSONLines = z.infer<typeof RawJSONLinesSchema>;

// ============ 会话模式相关类型（从 loop.ts 抽出，消除循环依赖）============
// 抽出原因：session/claudeRemote/claudeRemoteLauncher/permissionHandler/runClaude
// 从 loop.ts 反向 import 这些类型，与 loop→下游 的正向调用互引成环（7 条）。
// 下沉到本文件后，下游改从 ./types import，loop 不再被反向引用，环断开。
// 详见 docs/temp/lint-audit-report.md §九 P3

// claude 模块权限模式别名（绑定 Claude；保留可演化性：未来支持 non-claude agent 时分化）
export type PermissionMode = ClaudePermissionMode

/** SDK Query 动态控制引用，用于 setModel/setPermissionMode/getContextUsage */
export type QueryControlRef = {
  current: {
    setPermissionMode: (m: PermissionMode) => Promise<void>
    setModel: (m?: string) => Promise<void>
    applyFlagSettings: (settings: Record<string, unknown>) => Promise<void>
    /** 采集上下文用量（事件驱动；ContextUsageCollector.collect 内部调用） */
    getContextUsage: () => Promise<unknown>
  } | null
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
