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
import { PERMISSION_MODES, EFFORT_LEVELS } from './modes'

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
    apiProvider: z.string().optional()
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
    worktree: WorktreeMetadataSchema.optional(),
    /** Git 当前分支（session 启动及 local→remote 切换时采集） */
    gitBranch: z.string().optional(),
})

export type Metadata = z.infer<typeof MetadataSchema>

export const SDKUIHintsSchema = z.object({
    title: z.string().optional(),
    displayName: z.string().optional(),
    description: z.string().optional(),
    decisionReason: z.string().optional(),
    blockedPath: z.string().optional(),
    agentID: z.string().optional(),
    agentDescription: z.string().optional(),
    agentSubagentType: z.string().optional(),
})

export type SDKUIHints = z.infer<typeof SDKUIHintsSchema>

/** SDK 权限更新建议（与 @anthropic-ai/claude-agent-sdk 的 PermissionUpdate 结构对齐） */
export const PermissionBehaviorSchema = z.enum(['allow', 'deny', 'ask'])

export const PermissionUpdateDestinationSchema = z.enum([
    'userSettings', 'projectSettings', 'localSettings', 'session', 'cliArg'
])

export const PermissionRuleValueSchema = z.object({
    toolName: z.string(),
    ruleContent: z.string().optional(),
})

export const PermissionUpdateSchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('addRules'),
        rules: z.array(PermissionRuleValueSchema),
        behavior: PermissionBehaviorSchema,
        destination: PermissionUpdateDestinationSchema,
    }),
    z.object({
        type: z.literal('replaceRules'),
        rules: z.array(PermissionRuleValueSchema),
        behavior: PermissionBehaviorSchema,
        destination: PermissionUpdateDestinationSchema,
    }),
    z.object({
        type: z.literal('removeRules'),
        rules: z.array(PermissionRuleValueSchema),
        behavior: PermissionBehaviorSchema,
        destination: PermissionUpdateDestinationSchema,
    }),
    z.object({
        type: z.literal('setMode'),
        mode: PermissionModeSchema,
        destination: PermissionUpdateDestinationSchema,
    }),
    z.object({
        type: z.literal('addDirectories'),
        directories: z.array(z.string()),
        destination: PermissionUpdateDestinationSchema,
    }),
    z.object({
        type: z.literal('removeDirectories'),
        directories: z.array(z.string()),
        destination: PermissionUpdateDestinationSchema,
    }),
])

export type PermissionUpdate = z.infer<typeof PermissionUpdateSchema>
export type PermissionUpdateDestination = z.infer<typeof PermissionUpdateDestinationSchema>

export const AgentStateRequestSchema = z.object({
    tool: z.string(),
    arguments: z.unknown(),
    createdAt: z.number().nullish(),
    sdkHints: SDKUIHintsSchema.optional(),
    suggestions: z.array(PermissionUpdateSchema).optional(),
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
    activeForm: z.string()
})

export type TodoItem = z.infer<typeof TodoItemSchema>

export const TodosSchema = z.array(TodoItemSchema)

export const TaskItemSchema = z.object({
    id: z.string(),
    subject: z.string(),
    description: z.string().optional(),
    status: z.enum(['pending', 'in_progress', 'completed', 'deleted']),
    activeForm: z.string().optional(),
    owner: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
})

export type TaskItem = z.infer<typeof TaskItemSchema>

export const TasksSchema = z.array(TaskItemSchema)

/** 后台任务项 */
export const BackgroundTaskItemSchema = z.object({
    taskId: z.string(),
    toolUseId: z.string().nullable().optional(),
    toolName: z.enum(['Bash', 'Agent', 'Monitor']),
    description: z.string(),
    subagentType: z.string().optional(),
    status: z.enum(['running', 'completed', 'failed', 'stopped']),
    metrics: z.object({
        tokens: z.number(),
        toolUses: z.number(),
        durationMs: z.number(),
    }).optional(),
    summary: z.string().optional(),
    startedAt: z.number(),
    completedAt: z.number().optional(),
})

export type BackgroundTaskItem = z.infer<typeof BackgroundTaskItemSchema>

export const BackgroundTasksSchema = z.array(BackgroundTaskItemSchema)

export const TeamMemberSchema = z.object({
    name: z.string(),
    agentId: z.string().optional(),
    agentType: z.string().optional(),
    status: z.enum(['active', 'idle', 'shutdown', 'running', 'completed']).optional(),
    prompt: z.string().optional(),
    startedAt: z.number().optional(),
    lastProgressAt: z.number().optional(),
    taskIds: z.array(z.string()).optional(),
})

export type TeamMember = z.infer<typeof TeamMemberSchema>

export const TeamTaskSchema = z.object({
    id: z.string(),
    title: z.string().optional(),
    subject: z.string().optional(),
    description: z.string().optional(),
    status: z.enum(['pending', 'in_progress', 'completed', 'blocked', 'deleted']).optional(),
    owner: z.string().optional(),
    createdAt: z.number().optional(),
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
 * 上下文用量分类项（system prompt / tools / messages / MCP / memory 等）
 * 由 SDK getContextUsage().categories 裁剪而来
 */
export const ContextUsageCategorySchema = z.object({
    name: z.string(),
    tokens: z.number(),
    /** SDK 给的展示色（可选，前端可覆盖） */
    color: z.string().optional(),
})

/**
 * API token 用量明细（输入/输出/缓存读/缓存写）
 */
export const ContextUsageApiSchema = z.object({
    input_tokens: z.number(),
    output_tokens: z.number(),
    cache_read_input_tokens: z.number(),
    cache_creation_input_tokens: z.number(),
})

/**
 * 上下文窗口用量快照
 *
 * 由 CLI 调 SDK `Query.getContextUsage()` 采集，裁剪掉前端用不到的大字段
 * （gridRows / mcpTools / memoryFiles / skills 等）后，作为 runtimeState.contextUsage 落库。
 * 事件驱动采集（init / assistant / result / compact / clear），非定时轮询。
 */
export const ContextUsageSchema = z.object({
    totalTokens: z.number(),
    maxTokens: z.number(),
    /** 已用占 maxTokens 的百分比（0–100） */
    percentage: z.number(),
    /** autoCompact 触发阈值百分比，距此即「还剩多少到压缩」 */
    autoCompactThreshold: z.number().optional(),
    isAutoCompactEnabled: z.boolean(),
    categories: z.array(ContextUsageCategorySchema),
    apiUsage: ContextUsageApiSchema.nullable(),
    /** 会话累计成本（USD），取自 result.total_cost_usd */
    costUsd: z.number(),
})

export type ContextUsage = z.infer<typeof ContextUsageSchema>

/**
 * 运行时状态：存储会话的扩展状态（todos、teamState、model 等）
 * 未来新增功能可在此对象中添加字段，无需修改数据库 schema
 */
export const RuntimeStateSchema = z.object({
    todos: TodosSchema.optional(),
    tasks: TasksSchema.optional(),
    backgroundTasks: BackgroundTasksSchema.optional(),
    teamState: TeamStateSchema.optional(),
    model: z.string().nullable().optional(),
    effort: z.enum(EFFORT_LEVELS).optional(),
    contextUsage: ContextUsageSchema.optional()
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
    /**
     * 被 agent 消费的时刻；仅当该消息经过排队轨道（queue_state pending→consumed）时写入。
     * 非排队消息（agent/CLI/system 输出）恒为 null。排序请用 positionAt，不要 COALESCE 本字段。
     */
    submittedAt: z.number().nullable().optional(),
    /**
     * 排队生命周期状态：null（非排队轨道）/ 'pending'（等消费）/ 'consumed'（已消费）。
     * 「是否排队」的唯一读取依据，不再靠 submittedAt 缺失反推。
     */
    queueState: z.enum(['pending', 'consumed']).nullable().optional(),
    /** 排序锚点（= 落库 created_at；排队消息被消费时跳到消费时刻，保留「运行中消费的消息排在 turn 之后」UX） */
    positionAt: z.number().optional(),
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
            /** 通知种类:对话完成 / 需要授权 */
            kind: z.enum(['ready', 'permission']),
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
    }),
    SessionChangedSchema.extend({
        type: z.literal('messages-submitted'),
        localIds: z.array(z.string()),
        submittedAt: z.number(),
    })
])

export type SyncEvent = z.infer<typeof SyncEventSchema>
