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
