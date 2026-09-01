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

import {
    AgentStateSchema,
    AttachmentMetadataSchema,
    MetadataSchema,
    PermissionModeSchema,
    ProjectSchema,
    RuntimeStateSchema
} from '@mobi/shared/schemas'
import { LegacyFlatObjectSchema, UserMessageContentSchema } from '@mobi/shared'
import type { PermissionMode } from '@mobi/shared/types'
import { z } from 'zod'
import { UsageSchema } from '@/claude/types'

export type Usage = z.infer<typeof UsageSchema>

export type {
    AgentState,
    AttachmentMetadata,
    ClaudePermissionMode,
    Metadata,
    Session
} from '@mobi/shared/types'
export type SessionPermissionMode = PermissionMode
export type SessionModel = string | null

/** 项目实体（与 @mobi/shared 的 Project 同构；folders 是机器本地路径） */
export type Project = z.infer<typeof ProjectSchema>

export { AgentStateSchema, AttachmentMetadataSchema, MetadataSchema, ProjectSchema }

export const MachineMetadataSchema = z.object({
    host: z.string(),
    platform: z.string(),
    mobiCliVersion: z.string(),
    displayName: z.string().optional(),
    homeDir: z.string(),
    mobiHomeDir: z.string(),
    mobiLibDir: z.string()
})

export type MachineMetadata = z.infer<typeof MachineMetadataSchema>

export const RunnerStateSchema = z.object({
    status: z.union([z.enum(['running', 'shutting-down']), z.string()]),
    pid: z.number().optional(),
    httpPort: z.number().optional(),
    startedAt: z.number().optional(),
    shutdownRequestedAt: z.number().optional(),
    shutdownSource: z.union([z.enum(['mobile-app', 'cli', 'os-signal', 'unknown']), z.string()]).optional(),
    lastSpawnError: z.object({
        message: z.string(),
        pid: z.number().optional(),
        exitCode: z.number().nullable().optional(),
        signal: z.string().nullable().optional(),
        at: z.number()
    }).nullable().optional()
})

export type RunnerState = z.infer<typeof RunnerStateSchema>

export type Machine = {
    id: string
    seq: number
    createdAt: number
    updatedAt: number
    active: boolean
    activeAt: number
    metadata: MachineMetadata | null
    metadataVersion: number
    runnerState: RunnerState | null
    runnerStateVersion: number
}

export const CliMessagesResponseSchema = z.object({
    messages: z.array(z.object({
        id: z.string(),
        seq: z.number(),
        createdAt: z.number(),
        localId: z.string().nullable().optional(),
        /** native 锚点（rewind 判据与截断边界反查依赖；Hub DTO 已含，缺省兼容旧 Hub） */
        metadata: z.object({
            nativeId: z.string().optional(),
            nativeSessionId: z.string().optional()
        }).nullable().optional(),
        content: z.unknown()
    }))
})

export type CliMessagesResponse = z.infer<typeof CliMessagesResponseSchema>

export const CreateSessionResponseSchema = z.object({
    session: z.object({
        id: z.string(),
        namespace: z.string(),
        seq: z.number(),
        createdAt: z.number(),
        updatedAt: z.number(),
        active: z.boolean(),
        activeAt: z.number(),
        metadata: z.unknown().nullable(),
        metadataVersion: z.number(),
        agentState: z.unknown().nullable(),
        agentStateVersion: z.number(),
        running: z.boolean(),
        runningAt: z.number(),
        runtimeState: RuntimeStateSchema.optional(),
        model: z.string().nullable().optional(),
        permissionMode: PermissionModeSchema.optional(),
        tag: z.string().nullable().optional(),   // 用于 --resume 时复用 Hub session
        /** 归属项目（null = 游离） */
        projectId: z.string().nullable().optional()
    }),
    /** 归属项目实体（创建带 projectId 时返回；resume / 游离时缺失或 null） */
    project: ProjectSchema.nullable().optional()
})

export type CreateSessionResponse = z.infer<typeof CreateSessionResponseSchema>

export const CreateMachineResponseSchema = z.object({
    machine: z.object({
        id: z.string(),
        seq: z.number(),
        createdAt: z.number(),
        updatedAt: z.number(),
        active: z.boolean(),
        activeAt: z.number(),
        metadata: z.unknown().nullable(),
        metadataVersion: z.number(),
        runnerState: z.unknown().nullable(),
        runnerStateVersion: z.number()
    })
})

export type CreateMachineResponse = z.infer<typeof CreateMachineResponseSchema>

export const MessageMetaSchema = z.object({
    sentFrom: z.string().optional(),
    fallbackModel: z.string().nullable().optional(),
    customSystemPrompt: z.string().nullable().optional(),
    appendSystemPrompt: z.string().nullable().optional(),
    allowedTools: z.array(z.string()).nullable().optional(),
    disallowedTools: z.array(z.string()).nullable().optional(),
    /** 跨会话入站消息来源标注（UserPromptSubmit hook 观测的 peer 消息，from = 来源会话名） */
    crossSession: z.object({ from: z.string() }).optional(),
    /** 入站 turn 来源（spec 批次 D）：peer=跨会话消息 / scheduled=定时任务 / loop=/loop 唤醒。
     *  仅 hook 观测的入站 turn 落库时携带；普通 webapp user 消息缺省 */
    turnOrigin: z.enum(['peer', 'scheduled', 'loop']).optional()
})

export type MessageMeta = z.infer<typeof MessageMetaSchema>

/** 旧平铺 content（历史落库回放 / 旧 hub 窗口期）：宽松 schema 单源自 shared（与 normalizeUserContent 的 legacy 通道同一份规则），此处仅别名 */
const LegacyFlatUserContentSchema = LegacyFlatObjectSchema

export const UserMessageSchema = z.object({
    role: z.literal('user'),
    /** 内容四形态（string / 单 block / block 数组 / 旧平铺对象）；apiSession 门口只做形状分流，runClaude 消费时 normalizeUserContent 归一。
     *  旧平铺分支必须在前：z.object 默认剥未知键，新格式 block 分支先命中会把 attachments 静默丢掉
     *  （与 shared/userContentSchema 的归一陷阱同理）；looseObject 保留全部键无损透传 */
    content: z.union([LegacyFlatUserContentSchema, UserMessageContentSchema]),
    /** 客户端乐观 ID（用于排队消息的 consume 通知与取消） */
    localId: z.string().optional(),
    localKey: z.string().optional(),
    meta: MessageMetaSchema.optional()
})

export type UserMessage = z.infer<typeof UserMessageSchema>

export const AgentMessageSchema = z.object({
    role: z.literal('agent'),
    content: z.object({
        type: z.literal('output'),
        data: z.unknown()
    }),
    meta: MessageMetaSchema.optional()
})

export type AgentMessage = z.infer<typeof AgentMessageSchema>

export const MessageContentSchema = z.union([UserMessageSchema, AgentMessageSchema])

export type MessageContent = z.infer<typeof MessageContentSchema>
