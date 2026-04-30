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

import { z } from 'zod'
import { PERMISSION_MODES } from './modes'

export const PermissionModeSchema = z.enum(PERMISSION_MODES)

const MetadataSummarySchema = z.object({
    text: z.string(),
    updatedAt: z.number()
})

export const WorktreeMetadataSchema = z.object({
    basePath: z.string(),
    branch: z.string(),
    name: z.string(),
    worktreePath: z.string().optional(),
    createdAt: z.number().optional()
})

export type WorktreeMetadata = z.infer<typeof WorktreeMetadataSchema>

// ============ SDK 相关 Schema ============

/** SDK 斜杠命令信息 */
export const SlashCommandSchema = z.object({
    name: z.string(),
    description: z.string(),
    argumentHint: z.string()
})

export type SlashCommand = z.infer<typeof SlashCommandSchema>

/** SDK 子代理信息 */
export const AgentInfoSchema = z.object({
    name: z.string(),
    description: z.string(),
    model: z.string().optional()
})

export type AgentInfo = z.infer<typeof AgentInfoSchema>

/** SDK 模型信息 */
export const ModelInfoSchema = z.object({
    value: z.string(),
    displayName: z.string(),
    description: z.string()
})

export type ModelInfo = z.infer<typeof ModelInfoSchema>

/** SDK 账户信息 */
export const AccountInfoSchema = z.object({
    email: z.string().optional(),
    organization: z.string().optional(),
    subscriptionType: z.string().optional(),
    tokenSource: z.string().optional(),
    apiKeySource: z.string().optional(),
    apiProvider: z.enum(['firstParty', 'bedrock', 'vertex', 'foundry', 'anthropicAws', 'mantle']).optional()
})

export type AccountInfo = z.infer<typeof AccountInfoSchema>

/** SDK 快速模式状态 */
export const FastModeStateSchema = z.enum(['off', 'cooldown', 'on'])

export type FastModeState = z.infer<typeof FastModeStateSchema>

/** SDK 元数据（来自 initializationResult） */
export const SDKMetadataSchema = z.object({
    commands: z.array(SlashCommandSchema).optional(),
    agents: z.array(AgentInfoSchema).optional(),
    outputStyle: z.string().optional(),
    availableOutputStyles: z.array(z.string()).optional(),
    models: z.array(ModelInfoSchema).optional(),
    account: AccountInfoSchema.optional(),
    fastModeState: FastModeStateSchema.optional()
})

export type SDKMetadata = z.infer<typeof SDKMetadataSchema>

// ============ 元数据 Schema ============

export const MetadataSchema = z.object({
    path: z.string(),
    host: z.string(),
    version: z.string().optional(),
    name: z.string().optional(),
    os: z.string().optional(),
    summary: MetadataSummarySchema.optional(),
    machineId: z.string().optional(),
    claudeSessionId: z.string().optional(),
    tools: z.array(z.string()).optional(),
    /** SDK 元数据（来自 initializationResult） */
    sdkMetadata: SDKMetadataSchema.optional(),
    homeDir: z.string().optional(),
    mobiHomeDir: z.string().optional(),
    mobiLibDir: z.string().optional(),
    mobiToolsDir: z.string().optional(),
    startedFromRunner: z.boolean().optional(),
    hostPid: z.number().optional(),
    startedBy: z.enum(['runner', 'terminal']).optional(),
    lifecycleState: z.string().optional(),
    lifecycleStateSince: z.number().optional(),
    archivedBy: z.string().optional(),
    archiveReason: z.string().optional(),
    flavor: z.string().nullish(),
    worktree: WorktreeMetadataSchema.optional()
})

export type Metadata = z.infer<typeof MetadataSchema>

export const SDKUIHintsSchema = z.object({
    title: z.string().optional(),
    displayName: z.string().optional(),
    description: z.string().optional(),
    decisionReason: z.string().optional(),
    blockedPath: z.string().optional(),
    agentID: z.string().optional(),
})

export type SDKUIHints = z.infer<typeof SDKUIHintsSchema>

export const AgentStateRequestSchema = z.object({
    tool: z.string(),
    arguments: z.unknown(),
    createdAt: z.number().nullish(),
    sdkHints: SDKUIHintsSchema.optional(),
})

export type AgentStateRequest = z.infer<typeof AgentStateRequestSchema>

export const AgentStateSchema = z.object({
    controlledByUser: z.boolean().nullish(),
    requests: z.record(z.string(), AgentStateRequestSchema).nullish()
})

export type AgentState = z.infer<typeof AgentStateSchema>

export const TodoItemSchema = z.object({
    content: z.string(),
    status: z.enum(['pending', 'in_progress', 'completed']),
    priority: z.enum(['high', 'medium', 'low']),
    id: z.string()
})

export type TodoItem = z.infer<typeof TodoItemSchema>

export const TodosSchema = z.array(TodoItemSchema)

export const TeamMemberSchema = z.object({
    name: z.string(),
    agentType: z.string().optional(),
    status: z.enum(['active', 'idle', 'shutdown']).optional()
})

export type TeamMember = z.infer<typeof TeamMemberSchema>

export const TeamTaskSchema = z.object({
    id: z.string(),
    title: z.string(),
    description: z.string().optional(),
    status: z.enum(['pending', 'in_progress', 'completed', 'blocked']).optional(),
    owner: z.string().optional()
})

export type TeamTask = z.infer<typeof TeamTaskSchema>

export const TeamMessageSchema = z.object({
    from: z.string(),
    to: z.string(),
    summary: z.string(),
    type: z.enum(['message', 'broadcast', 'shutdown_request', 'shutdown_response']),
    timestamp: z.number()
})

export type TeamMessage = z.infer<typeof TeamMessageSchema>

export const TeamStateSchema = z.object({
    teamName: z.string(),
    description: z.string().optional(),
    members: z.array(TeamMemberSchema).optional(),
    tasks: z.array(TeamTaskSchema).optional(),
    messages: z.array(TeamMessageSchema).optional(),
    updatedAt: z.number().optional()
})

export type TeamState = z.infer<typeof TeamStateSchema>

/**
 * 运行时状态：存储会话的扩展状态（todos、teamState、model 等）
 * 未来新增功能可在此对象中添加字段，无需修改数据库 schema
 */
export const RuntimeStateSchema = z.object({
    todos: TodosSchema.optional(),
    teamState: TeamStateSchema.optional(),
    model: z.string().nullable().optional()
    // 未来可扩展：fooState: FooStateSchema.optional()
})

export type RuntimeState = z.infer<typeof RuntimeStateSchema>

export const AttachmentMetadataSchema = z.object({
    id: z.string(),
    filename: z.string(),
    mimeType: z.string(),
    size: z.number(),
    path: z.string(),
    previewUrl: z.string().optional()
})

export type AttachmentMetadata = z.infer<typeof AttachmentMetadataSchema>

/** SDK uuid 尚未就绪时的 snapshot fallback id */
export const SNAPSHOT_PENDING_ID = 'snapshot-pending'

export const DecryptedMessageSchema = z.object({
    id: z.string(),
    seq: z.number().nullable(),
    localId: z.string().nullable(),
    content: z.unknown(),
    createdAt: z.number(),
    /** 标识流式快照消息（未落库，Hub 直接透传给 Web） */
    snapshot: z.boolean().optional(),
})

export type DecryptedMessage = z.infer<typeof DecryptedMessageSchema>

export const SessionSchema = z.object({
    id: z.string(),
    namespace: z.string(),
    seq: z.number(),
    createdAt: z.number(),
    updatedAt: z.number(),
    active: z.boolean(),
    activeAt: z.number(),
    metadata: MetadataSchema.nullable(),
    metadataVersion: z.number(),
    agentState: AgentStateSchema.nullable(),
    agentStateVersion: z.number(),
    running: z.boolean(),
    runningAt: z.number(),
    runtimeState: RuntimeStateSchema.optional(),
    permissionMode: PermissionModeSchema.optional(),
    mode: z.enum(['local', 'remote']).optional(),
    groupKey: z.string().optional(),
    tag: z.string().nullable().optional()   // Hub session 的标签，用于 getOrCreateSession 时复用
})

export type Session = z.infer<typeof SessionSchema>

const SessionEventBaseSchema = z.object({
    namespace: z.string().optional()
})

const SessionChangedSchema = SessionEventBaseSchema.extend({
    sessionId: z.string()
})

const MachineChangedSchema = SessionEventBaseSchema.extend({
    machineId: z.string()
})

export const SyncEventSchema = z.discriminatedUnion('type', [
    SessionChangedSchema.extend({
        type: z.literal('session-added'),
        data: z.unknown().optional()
    }),
    SessionChangedSchema.extend({
        type: z.literal('session-updated'),
        data: z.unknown().optional()
    }),
    SessionEventBaseSchema.extend({
        type: z.literal('session-removed'),
        sessionId: z.string()
    }),
    SessionChangedSchema.extend({
        type: z.literal('message-received'),
        message: DecryptedMessageSchema
    }),
    MachineChangedSchema.extend({
        type: z.literal('machine-updated'),
        data: z.unknown().optional()
    }),
    SessionEventBaseSchema.extend({
        type: z.literal('toast'),
        data: z.object({
            title: z.string(),
            body: z.string(),
            sessionId: z.string(),
            url: z.string()
        })
    }),
    SessionChangedSchema.extend({
        type: z.literal('message-snapshot'),
        message: DecryptedMessageSchema
    }),
    SessionEventBaseSchema.extend({
        type: z.literal('heartbeat'),
        data: z.object({
            timestamp: z.number()
        }).optional()
    }),
    SessionEventBaseSchema.extend({
        type: z.literal('connection-changed'),
        data: z.object({
            status: z.string(),
            subscriptionId: z.string().optional()
        }).optional(),
        connected: z.boolean().optional(),
        reconnected: z.boolean().optional()
    }),
    SessionChangedSchema.extend({
        type: z.literal('idle-timeout-warning'),
        data: z.object({
            timeoutAt: z.number(),
            remainingMs: z.number()
        })
    })
])

export type SyncEvent = z.infer<typeof SyncEventSchema>
