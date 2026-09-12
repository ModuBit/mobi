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

// ============ 项目相关 Schema ============

/** 项目源文件夹（primary 即 CC 的 cwd） */
export const ProjectFolderSchema = z.object({
    path: z.string(),
    primary: z.boolean()
})

export type ProjectFolder = z.infer<typeof ProjectFolderSchema>

/**
 * 项目 folders 校验错误码：校验规则跨端共享（web 表单门禁 + hub API 守卫），
 * 但文案是各端展示层的事——hub 用 PROJECT_FOLDERS_ERROR_MESSAGES 出英文 400 文案，
 * web 按码映射 i18n key
 */
export type ProjectFoldersError =
    | 'empty'          // 列表为空
    | 'empty_path'     // 存在空路径 / 纯空白路径（空文件夹曾可建出项目）
    | 'no_primary'     // 无主目录
    | 'multi_primary'  // 多个主目录

/** hub 400 响应文案（web 不用，见 ProjectFoldersError 注释） */
export const PROJECT_FOLDERS_ERROR_MESSAGES: Record<ProjectFoldersError, string> = {
    empty: 'At least one folder is required',
    empty_path: 'Every folder path is required',
    no_primary: 'Exactly one primary folder is required',
    multi_primary: 'Exactly one primary folder is required',
}

/** 校验项目文件夹列表：≥1 项、每项 path trim 非空、恰一项 primary；返回错误码或 null */
export function validateProjectFolders(folders: ProjectFolder[]): ProjectFoldersError | null {
    if (folders.length === 0) return 'empty'
    if (folders.some(f => !f.path.trim())) return 'empty_path'
    const primaries = folders.filter(f => f.primary)
    if (primaries.length === 0) return 'no_primary'
    if (primaries.length > 1) return 'multi_primary'
    return null
}

/** 项目实体（folders 是机器本地路径，项目归属 machineId） */
export const ProjectSchema = z.object({
    id: z.string(),
    namespace: z.string(),
    machineId: z.string(),
    name: z.string(),
    folders: z.array(ProjectFolderSchema),
    createdAt: z.number(),
    updatedAt: z.number(),
    seq: z.number()
})

export type Project = z.infer<typeof ProjectSchema>

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
    resolvedModel: z.string().optional(),
    displayName: z.string(),
    description: z.string(),
    supportsEffort: z.boolean().optional(),
    supportedEffortLevels: z.array(z.string()).optional(),
    supportsAdaptiveThinking: z.boolean().optional(),
    supportsFastMode: z.boolean().optional(),
    supportsAutoMode: z.boolean().optional(),
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

/**
 * fork 激活簿记（点 fork 时写入，激活成功后清除，fork-session spec §5.1）。
 * CLI 激活时据此组装 forkSession/resumeSessionAt/sessionId 三个 SDK option。
 */
export const ForkFromMetadataSchema = z.object({
    /** parent 的 mobi 会话行 id（溯源消息 ref / 激活预检的目标会话） */
    parentSessionId: z.string(),
    /** parent 当前 native session id（激活时作 resumeToken） */
    parentNativeId: z.string(),
    /** 分叉锚点消息的 native id（激活时作 resumeSessionAt） */
    anchorNativeId: z.string(),
})

export type ForkFromMetadata = z.infer<typeof ForkFromMetadataSchema>

/** fork 持久溯源（终身保留；存在即禁止再次 fork，fork 入口判据与「fork 自」系统消息消费） */
export const ForkedFromMetadataSchema = z.object({
    /** parent 的 mobi 会话行 id */
    sessionId: z.string(),
})

export type ForkedFromMetadata = z.infer<typeof ForkedFromMetadataSchema>

/**
 * fork 激活失败错误态（fork-session spec §5.3）。
 *
 * 契约：CLI 激活预检/激活失败时写入（ticket 04 对接），激活成功或用户删除会话时清除。
 * ⚠️ 失败时必须保留 forkFrom（不清除）——web 的待激活判定与 hub 的删除守卫都以 forkFrom
 * 在场为「未激活」依据；forkError 只是叠加的失败标记，不是替代。
 */
export const ForkErrorMetadataSchema = z.object({
    /** 失败原因码（稳定契约，web 按码映射文案；未知码回退通用文案）。已知码见 FORK_ERROR_CODES */
    code: z.string(),
    /** 失败时刻（epoch ms） */
    at: z.number(),
    /** 附加调试细节（可选，UI 不直接展示） */
    detail: z.string().optional(),
})

export type ForkErrorMetadata = z.infer<typeof ForkErrorMetadataSchema>

/**
 * fork 激活失败原因码已知集合（web 文案映射用；生产方 ticket 04 按此取值，新增码时同步扩展）。
 * code 字段本身保持松散 string——schema 不硬拒未知码，老 web 端遇新码回退通用文案（向前兼容）。
 * - 'anchor-invalidated'：激活预检失败，锚点已不在 parent transcript 上（parent rewind 深于锚点）
 * - 'parent-transcript-missing'：激活预检失败，parent transcript 文件缺失
 * - 'activation-failed'：resume spawn / fork query 执行失败（如 CLI 离线），恢复后重发消息即重试
 */
export const FORK_ERROR_CODES = ['anchor-invalidated', 'parent-transcript-missing', 'activation-failed'] as const

export type ForkErrorCode = (typeof FORK_ERROR_CODES)[number]

export const MetadataSchema = z.object({
    path: z.string(),
    host: z.string(),
    version: z.string().optional(),
    name: z.string().optional(),
    os: z.string().optional(),
    summary: MetadataSummarySchema.optional(),
    machineId: z.string().optional(),
    nativeSessionId: z.string().optional(),
    /** 上下文边界指针：最近一次 compact/clear 边界消息的 seq（O(1) 边界判定，fork/rewind 入口共用；缺失=未回填） */
    contextBoundarySeq: z.number().optional(),
    /** fork 激活簿记：激活成功后清除（fork-session spec §5.1）。必须声明——否则 sessionCache 的 zod strip 会裁掉（ticket 02 先例） */
    forkFrom: ForkFromMetadataSchema.optional(),
    /** fork 持久溯源：终身保留，存在即禁止再次 fork（fork-session spec §2） */
    forkedFrom: ForkedFromMetadataSchema.optional(),
    /** fork 激活失败错误态：失败时保留 forkFrom 并叠加本字段（激活成功或删除时清除，fork-session spec §5.3；ticket 04 写入） */
    forkError: ForkErrorMetadataSchema.optional(),
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
    /** 创建会话时冻结的额外工作目录（resume 回放用；已过滤不存在的路径） */
    additionalDirectories: z.array(z.string()).optional(),
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
    /** SDK 0.3.268 审批 hint：不可被单键误批——web 审批默认视觉重心落拒绝项（upstream-suggestions ⑤） */
    defaultToNo: z.boolean().optional(),
    /** SDK 0.3.268 审批 hint：不得提供持久「不再询问」档（规则会超出本 ask 的授权范围）——
     *  web 隐藏全部持久档（含 fallback 字面档与 Edit 全部允许） */
    suppressAlwaysAllowRule: z.boolean().optional(),
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

/**
 * 审批/elicitation 表单 answers 值类型（批次 C，spec D3）：
 * flat string/string[]（AskUserQuestion 等既有消费）+ number/boolean（elicitation 表单值）
 * + 嵌套格式（request_user_input）。elicitation cli 端按 requestedSchema 转型后组 content。
 */
export type PermissionAnswers =
    | Record<string, string | number | boolean | string[]>
    | Record<string, { answers: string[] }>

/**
 * MCP elicitation 借道 agentState.requests 通道时使用的合成工具名（批次 C，spec D1）。
 * elicitation 条目与普通审批在类型上不可区分，cli/web 运行时都靠该名判断——
 * 单一来源在 shared，两端字面量漂移即编译错误（此前双字面量仅靠注释同步）。
 */
export const ELICITATION_TOOL_NAME = 'mcp_elicitation'

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
    /** 'unknown'：task_updated 补建条目无法确证工具类型（patch 不携带 tool_use_id/subagent_type），诚实降级而非冒充 Bash */
    toolName: z.enum(['Bash', 'Agent', 'Monitor', 'unknown']),
    description: z.string(),
    subagentType: z.string().optional(),
    /** 'paused'：task_updated patch 可携带 paused（SDKTaskUpdatedMessage.patch.status 联合），枚举无 pending 时 paused 是最近的诚实表达 */
    status: z.enum(['running', 'completed', 'failed', 'stopped', 'paused']),
    /** 是否为后台任务（进入 backgroundTasks 的都是后台任务，恒 true）。SDK 对所有 Bash/Agent 任务都 emit task_started，此标志由 hub 判定后写入，供 Web 端统一区分前后台渲染。
     *  default(true)：存量 DB 记录（isBackground 字段加入前持久化的 runtime_state）经 RuntimeStateSchema.safeParse 时缺此字段，默认 true 与「进入 backgroundTasks 即后台」的语义一致，避免整条数组被 strip */
    isBackground: z.boolean().default(true),
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

/** 可清理的 runtimeState 字段白名单（清理 API 契约的单源）：
 *  hub 路由 z.enum / store 可清理集合 / web 清理按钮类型均由此派生，新增字段只改这里 */
export const CLEARABLE_RUNTIME_STATE_FIELDS = [
    'todos',
    'tasks',
    'backgroundTasks',
    'foregroundTasks',
    'teamState',
    'goalStatus',
    'cacheStatus',
] as const

export type ClearableRuntimeStateField = (typeof CLEARABLE_RUNTIME_STATE_FIELDS)[number]

/** 前台执行中任务条目（foreground-tasks spec D3/D8）：hub 从消息投影维护的「正在跑的前台任务」清单。
 *  与 backgroundTasks 的区别：前台任务无 CLI 上报通道，纯 hub 消息投影；无状态字段（等待审批与
 *  执行中统一视为运行中，spec D5）。第一版只收 Agent 类工具，字段名留非 Agent 扩展空间。 */
export const ForegroundTaskItemSchema = z.object({
    toolUseId: z.string(),
    description: z.string().nullable().optional(),
    subagentType: z.string().nullable().optional(),
    startedAt: z.number(),
})

export type ForegroundTaskItem = z.infer<typeof ForegroundTaskItemSchema>

export const ForegroundTasksSchema = z.array(ForegroundTaskItemSchema)

/**
 * 从 background_tasks_changed 的 tasks 数组提取存活后台任务 id 集合（CLI 与 Hub 共用规则）：
 * task_id 为非空字符串才收录；ambient === true 的家务任务（checkpoint/live-update watcher 等）
 * 跳过——「全部停止」/ 后台面板只面向用户可见的工作（spec D1/D2）。
 * 非数组输入返回空集合（调用方按 REPLACE 语义整体替换即清空）。
 */
export function extractLiveBackgroundTaskIds(tasks: unknown): Set<string> {
    const ids = new Set<string>()
    if (!Array.isArray(tasks)) return ids
    for (const item of tasks) {
        if (typeof item !== 'object' || item === null) continue
        const t = item as { task_id?: unknown; ambient?: unknown }
        if (t.ambient === true) continue
        if (typeof t.task_id === 'string' && t.task_id.length > 0) ids.add(t.task_id)
    }
    return ids
}

export const TeamMemberSchema = z.object({
    name: z.string(),
    agentId: z.string().optional(),
    agentType: z.string().optional(),
    status: z.enum(['active', 'idle', 'shutdown', 'running', 'completed']).optional(),
    prompt: z.string().optional(),
    startedAt: z.number().optional(),
    lastProgressAt: z.number().optional(),
    taskIds: z.array(z.string()).optional(),
    /** 派发该 teammate 的 Agent tool_use id 列表，供 tool_result 到达时配对标记完成 */
    toolUseIds: z.array(z.string()).optional(),
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

/** 类目细分中的类目 key（语义化，CC 显示名带后缀变体，key 化避免 web 端字符串匹配；顺序 = CC 实现序） */
export const CONTEXT_USAGE_CATEGORY_KEYS = [
    'systemPrompt',
    'systemTools',
    'mcpTools',
    'memoryFiles',
    'skills',
    'messages',
] as const

export const ContextUsageCategoryKeySchema = z.enum(CONTEXT_USAGE_CATEGORY_KEYS)

export type ContextUsageCategoryKey = z.infer<typeof ContextUsageCategoryKeySchema>

/**
 * 上下文类目细分（SDK getContextUsage({detail:'summary'}) 口径：总量锚定最近 response usage，
 * 类目数字为本地估算）。可选字段——缺省 = 该轮无细分（旧 CLI / local 模式 / 采集失败）。
 */
export const ContextUsageBreakdownSchema = z.object({
    /** 按 CC 顺序排列的类目占用（不含 free / autocompact buffer，二者单独成字段） */
    categories: z.array(z.object({
        key: ContextUsageCategoryKeySchema,
        tokens: z.number(),
    })),
    /** 剩余空间（autocompact buffer 之外的净剩余） */
    freeTokens: z.number(),
    /** 自动压缩预留 buffer（auto-compact 关闭时缺省）；实际可用 = maxTokens − totalTokens − autocompactBufferTokens */
    autocompactBufferTokens: z.number().optional(),
    /** MCP 逐 server 占用（serverName 聚合） */
    mcpTools: z.array(z.object({ name: z.string(), tokens: z.number() })),
    /** Skills 逐项占用（带 plugin 时 name 形如 "plugin:skill"） */
    skills: z.array(z.object({ name: z.string(), tokens: z.number() })),
    /** CLAUDE.md 等 memory 文件逐个占用 */
    memoryFiles: z.array(z.object({ path: z.string(), tokens: z.number() })),
})

export type ContextUsageBreakdown = z.infer<typeof ContextUsageBreakdownSchema>

/**
 * 上下文窗口用量快照
 *
 * 完全由 SDK 消息流派生，**不调用** `Query.getContextUsage()`（后者会触发大量
 * count_tokens / Haiku 兜底请求，撑爆 provider 请求频率限制）。由 CLI 本地组装：
 * - totalTokens：主线最后一条 assistant 消息的 input + cache_creation + cache_read + output
 *   （message_start 三项输入 + message_delta 累计 output = 该条消息完成后的瞬时窗口占用）
 * - maxTokens：窗口大小，权威来源 result.modelUsage[model].contextWindow（launcher 记忆）；
 *   首 turn / resume 后由模型名猜测预填（guessContextWindow，[1m]→1M 其余→200k），
 *   result 携带 contextWindow 时用真实值覆盖（渠道不返回时猜测值整个会话生效，见 pending #57）
 * - percentage：totalTokens / maxTokens × 100
 * - costUsd：result.total_cost_usd（会话累计成本，launcher 记忆）
 * 上报时机：每条主线 assistant 消息实时上报（turn 内上涨）；result 兜底一次；compact_boundary
 * 用 post_tokens 反映压缩后占用。注意 result.usage 是 turn 内累计，不是瞬时水位，不作 totalTokens。
 *
 * 分类细分经可选 breakdown 字段携带（getContextUsage({detail:'summary'}) 本地估算口径，
 * 缺省 = 该轮无细分——旧 CLI / local 模式 / 采集失败）。
 * 「距窗口上限剩余」= maxTokens − totalTokens，无需阈值。
 */
export const ContextUsageSchema = z.object({
    totalTokens: z.number(),
    maxTokens: z.number(),
    /** 已用占 maxTokens 的百分比（0–100） */
    percentage: z.number(),
    /** 会话累计成本（USD），取自 result.total_cost_usd */
    costUsd: z.number(),
    /**
     * 瞬时水位四项细分（assistant 路径填充，web Popover 展示 + 缓存命中率计算）。
     * 可选：compact 路径的 post_tokens 只有总量，细分不可知 → 缺省
     */
    inputTokens: z.number().optional(),
    outputTokens: z.number().optional(),
    cacheReadTokens: z.number().optional(),
    cacheCreationTokens: z.number().optional(),
    /** 类目细分（见 ContextUsageBreakdownSchema），缺省 = 该轮无细分 */
    breakdown: ContextUsageBreakdownSchema.optional(),
    /** 模型最大窗口（modelUsage 主模型 contextWindow，未受 autocompact 收缩）。
     *  仅信息展示（Popover「模型上限」行），不参与百分比计算；缺省 = 未知（隐藏该行） */
    modelContextTokens: z.number().optional(),
})

export type ContextUsage = z.infer<typeof ContextUsageSchema>

/**
 * Claude Code `/goal` 的状态。数据源为 transcript 的 attachment.goal_status。
 * 除 met/condition 外字段全可选（evaluator 每 turn 落盘时可能只带部分）。
 */
export const GoalStatusSchema = z.object({
    met: z.boolean(),
    condition: z.string(),
    reason: z.string().optional(),
    iterations: z.number().optional(),
    durationMs: z.number().optional(),
    tokens: z.number().optional(),
})

export type GoalStatus = z.infer<typeof GoalStatusSchema>

/**
 * 会话恢复时的 prompt cache 状态（SDK 0.3.268 SessionStart hook input，仅 resume/fork 且
 * prompt_cache_likely_expired=true 时上报）。首 turn result 到达后 CLI 清空——过期提示只在
 * 「恢复后首轮前」有意义，常驻会误导。
 */
export const CacheStatusSchema = z.object({
    /** 距上次响应超过 prompt-cache TTL，首轮请求将重缓存 */
    expired: z.boolean(),
    /** 重缓存规模：恢复 transcript 的最后响应 input + cache_read + cache_creation + output tokens */
    contextTokens: z.number().optional(),
    /** 恢复的 transcript 距上次 assistant 响应的秒数（过期归因依据） */
    secondsSinceLastResponse: z.number().optional(),
    /** 按会话模型 cache-write 价估算的重缓存成本（美元） */
    estimatedCacheWriteUsd: z.number().optional(),
    /** 观测时间（epoch ms） */
    observedAt: z.number(),
})

export type CacheStatus = z.infer<typeof CacheStatusSchema>

/**
 * 运行时状态：存储会话的扩展状态（todos、teamState、model 等）
 * 未来新增功能可在此对象中添加字段，无需修改数据库 schema
 */
export const RuntimeStateSchema = z.object({
    todos: TodosSchema.optional(),
    tasks: TasksSchema.optional(),
    backgroundTasks: BackgroundTasksSchema.optional(),
    /** 前台执行中任务清单：hub 从消息投影维护（foreground-tasks spec D1/D4），工具出结果或
     *  轮次 result 到达时移除，空清单删字段。与 backgroundTasks 无交集（后台任务另有上报通道） */
    foregroundTasks: ForegroundTasksSchema.optional(),
    teamState: TeamStateSchema.optional(),
    model: z.string().nullable().optional(),
    effort: z.enum(EFFORT_LEVELS).optional(),
    /** 当前权限模式（CLI keep-alive 上报落库，hub 重启后 resume 回放；与 model/effort/outputStyle 持久化对齐）。
     * catch：CLI 新版本引入未知权限模式时单字段降级为 undefined（回落 default），不拖垮整条
     * runtimeState 解析——safeParse 全有全无会让 model/effort/outputStyle 等恢复字段一并丢失 */
    permissionMode: z.enum(PERMISSION_MODES).optional().catch(undefined),
    /** 当前 output style（CLI keep-alive 上报落库，进程重启后 resume 回放；default 视为未设置可省略） */
    outputStyle: z.string().optional(),
    contextUsage: ContextUsageSchema.optional(),
    /** 当前/最近一次 goalStatus；null 表示无 goal 或已清空 */
    goalStatus: GoalStatusSchema.nullable().optional(),
    /** 当前轮次起点（epoch ms，CLI running 翻转 false→true 时上报）。StatusBar 计时的权威
     *  来源——消息窗口化后 web 内存窗口可能已不含本轮 user 消息，仅靠消息推导会失真
     *  （docs/pending.md #55 方案 1）。轮次结束后保留旧值（running=false 时 UI 不消费） */
    runStartedAt: z.number().optional(),
    /** 会话恢复（resume/fork）时的 prompt cache 状态；首 turn result 到达后 CLI 清空（删除字段） */
    cacheStatus: CacheStatusSchema.optional(),
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
     * 上游 native 事实（rewind 锚点）。nativeId = transcript 消息 uuid（用户消息 = CLI push
     * 时生成的 uuid；SDK 下发消息 = 与 localId 同值）。nativeSessionId = 所属上游 session
     * uuid（新会话首批用户消息 push 时未知，待 attach 补写）。null/缺省 = 未绑定（不可 rewind）。
     */
    metadata: z.object({
        nativeId: z.string().optional(),
        nativeSessionId: z.string().optional(),
        nativeAckAt: z.number().optional()
    }).nullable().optional(),
    /**
     * 生命周期状态：null（非排队轨道，agent/CLI/system 输出）/ 'queued'（webapp 提交、等 CLI 消费）/
     * 'pushed'（CLI 已 push 给 Claude Code）/ 'acked'（CC isReplay 回显确认）/
     * 'processing'（CC 开始处理，P2 写入）/ 'done'|'cancelled'|'discarded'（CC 终态，P2 写入）/
     * 'refused'（跨会话 peer 消息被接收侧策略拒收，command_lifecycle:refused，U-8）/
     * 'withdrawn'（撤回，#53 本批实施）。
     * 「是否排队」的唯一读取依据（lifecycle==='queued'），不再靠时间戳缺失反推。
     */
    lifecycle: z.enum(['queued', 'pushed', 'acked', 'processing', 'done', 'cancelled', 'discarded', 'refused', 'withdrawn']).nullable().optional(),
    /** 最近一次 lifecycle 转换的时刻；非排队消息恒为 null。排序请用 positionAt，不要 COALESCE 本字段 */
    lifecycleAt: z.number().nullable().optional(),
    /** 排序锚点（= 落库 created_at；排队消息被消费时跳到消费时刻，保留「运行中消费的消息排在 turn 之后」UX） */
    positionAt: z.number().optional(),
    content: z.unknown(),
    createdAt: z.number(),
    /** 标识流式快照消息（未落库，Hub 直接透传给 Web） */
    snapshot: z.boolean().optional(),
    /** snapshot 流当前帧序号（delta 协议票 02）：web 据此衔接后续增量帧（baseRev 校验） */
    snapshotRev: z.number().int().nonnegative().optional(),
})

export type DecryptedMessage = z.infer<typeof DecryptedMessageSchema>

// ============================================================================
// Snapshot Delta 协议（.scratch/snapshot-delta spec）
// CLI→hub（session-message）与 hub→web（message-snapshot-delta）共用的增量载荷。
// 链路无 diff：CLI 从流式 buffer 产出 op，hub/web 只 apply；单连接内 TCP 有序，
// 唯一风险是断线，恢复靠事件驱动重基线（流首帧全量 / 重连重发全量），无周期 checkpoint。
// ============================================================================

/** snapshot 消息内的内容块（与 CLI StreamSnapshotSender 的 buildBlocks 输出一致） */
export const SnapshotBlockSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('text'), text: z.string() }),
    z.object({
        type: z.literal('thinking'),
        thinking: z.string(),
        /** 思考耗时（content_block_start→stop），done 翻转时携带 */
        durationMs: z.number().optional(),
        /** content_block_stop 后置 true（思考完成标记） */
        done: z.boolean().optional(),
    }),
    z.object({
        type: z.literal('tool_use'),
        id: z.string(),
        name: z.string(),
        /** 半截 JSON 无意义：流式期恒为 {}（占位），content_block_stop 后为完整 input */
        input: z.unknown(),
    }),
])

export type SnapshotBlock = z.infer<typeof SnapshotBlockSchema>

/**
 * 块级增量 op——三种形态覆盖 snapshot 的全部演化路径（与 CLI buffer 状态变迁一一对应）：
 * - append：text/thinking 后缀追加（流量大头）
 * - new-block：新块起始（含 tool_use input={} 占位）
 * - replace-block：一次性全块替换（tool_use ready 翻转 / thinking done 标记）
 * index 为块在消息 content 数组中的位置（发送方与 apply 方按同一插入序对齐）。
 */
export const SnapshotBlockDeltaSchema = z.discriminatedUnion('op', [
    z.object({ op: z.literal('append'), index: z.number().int().nonnegative(), text: z.string() }),
    z.object({ op: z.literal('new-block'), index: z.number().int().nonnegative(), block: SnapshotBlockSchema }),
    z.object({ op: z.literal('replace-block'), index: z.number().int().nonnegative(), block: SnapshotBlockSchema }),
])

export type SnapshotBlockDelta = z.infer<typeof SnapshotBlockDeltaSchema>

/**
 * snapshot 增量帧（delta-only）：baseRev 必须与接收方已持有的 rev 严格衔接，
 * 不连续即丢弃等全量基线。rev 由产出方（CLI）按流（每条消息）分配、单调递增。
 * 全量帧不走本 schema——CLI→hub 以 message + frame:{rev, baseRev:null} 标记携带，
 * hub→web 以 message-snapshot 事件携带（见 buildSnapshotMessage）。
 */
export const SnapshotDeltaFrameSchema = z.object({
    localId: z.string(),
    rev: z.number().int().nonnegative(),
    baseRev: z.number().int().nonnegative(),
    deltas: z.array(SnapshotBlockDeltaSchema),
})

export type SnapshotDeltaFrame = z.infer<typeof SnapshotDeltaFrameSchema>

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
    tag: z.string().nullable().optional(),   // Hub session 的标签，用于 getOrCreateSession 时复用
    /** 归属项目（null = 游离，进「最近」） */
    projectId: z.string().nullable().optional(),
    /** 会话置顶（true = 进「置顶」分组，同时从「项目」「最近」过滤掉） */
    pinned: z.boolean().optional(),
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

/** project 事件（hub 的 EventPublisher.resolveNamespace 不认 projectId，无缓存回查，namespace 必填） */
const ProjectChangedSchema = SessionEventBaseSchema.extend({
    projectId: z.string(),
    namespace: z.string()
})

/**
 * open_in_mobi 的载荷：对"打开什么"再判别（codex open_in_codex 同构）。
 * 后续扩展 target（browser / review 等）在此增量添加成员。
 */
export const OpenInMobiTargetSchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('file'),
        /** 文件绝对路径（agent 本地视角 = CLI 所在机器，与 read-file 边界一致） */
        path: z.string().min(1).describe('Absolute path of the file to open (on the machine where this CLI runs)'),
        /** 可选定位行（编辑器跳转；read-file API 已支持行级 range） */
        line: z.number().int().positive().optional().describe('Optional line number to scroll to'),
    }),
    z.object({
        type: z.literal('terminal'),
        // 打开发起会话的终端 tab；会话归属由事件信封 sessionId 承载，payload 不重复携带
    }),
])

/**
 * UI 命令动作判别联合（agent → Hub → Web 的 A 类呈现指令）。
 * 统一信封形状 { action, payload }：payload 按 action 自定义，无统一 target 概念不强加
 * （会话无关动作如 set_theme 同型扩展）。
 */
export const UiCommandActionSchema = z.discriminatedUnion('action', [
    z.object({
        action: z.literal('open_in_mobi'),
        payload: OpenInMobiTargetSchema,
    }),
])

export type UiCommandAction = z.infer<typeof UiCommandActionSchema>

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
        message: DecryptedMessageSchema,
        /** 补写回填标记（hub attach 路径）：标识这是 DB metadata 补写后的旧行重播而非新消息，
         *  web 端据此只 merge 已在窗口的行、不 append——否则 resume 后历史行（!bash 合成对/
         *  compact 事件行）被误当新消息以旧 positionAt 插入出 ghost 气泡 */
        backfill: z.boolean().optional()
    }),
    SessionChangedSchema.extend({
        type: z.literal('rewind-truncated'),
        /** 软删除起点：seq >= deleteFromSeq 的消息行已标记删除 */
        deleteFromSeq: z.number()
    }),
    SessionChangedSchema.extend({
        type: z.literal('rewind-completed'),
        /** 文件是否已恢复（false 时 error 携带原因） */
        filesRestored: z.boolean(),
        error: z.string().optional(),
        /** 被安全护栏跳过的文件数（symlink/hardlink/非常规文件，spec E2）；>0 时 web 提示 */
        skippedLinks: z.number().optional()
    }),
    // 撤回刚发消息（#53 / 批次 A）：hub 已软删除该行及其后全部行，blocks 为 content
    // 信封内层 UserContentBlock[]（web deserializeSegments 还原 composer，失败兜底 originalText）
    SessionChangedSchema.extend({
        type: z.literal('message-withdrawn'),
        /** 被撤回消息的 localId（web 乐观移除锚点） */
        localId: z.string(),
        /** 撤回时的完整内容（信封内层 blocks），供 composer 回填 */
        blocks: z.array(z.unknown()),
        originalText: z.string().nullable()
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
    // snapshot 增量帧（delta 协议票 02）：hub→web 段按订阅进度转发；web 收到后按序拼接，
    // baseRev 与本地持有 rev 不衔接即丢弃等全量基线（message-snapshot 全量或 full message 终态）
    SessionChangedSchema.extend({
        type: z.literal('message-snapshot-delta'),
        localId: z.string(),
        rev: z.number().int().nonnegative(),
        baseRev: z.number().int().nonnegative(),
        deltas: z.array(SnapshotBlockDeltaSchema),
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
    }),
    // 后台刷新 sdkMetadata 完成且内容有变 → 通知 web refetch（SWR 配套，见 hub metadata 端点）
    SessionEventBaseSchema.extend({
        type: z.literal('sdk-metadata-refreshed'),
        sessionId: z.string()
    }),
    ProjectChangedSchema.extend({ type: z.literal('project-added') }),
    ProjectChangedSchema.extend({ type: z.literal('project-updated') }),
    ProjectChangedSchema.extend({ type: z.literal('project-removed') }),
    // agent 触达 mobi 界面的 A 类 UI 命令（瞬态事件：不落库、不进快照、刷新不恢复，见 .scratch/agent-apps/spec.md D9）。
    // sessionId 是可选路由元数据：Hub 从 socket sid 解析后盖章（会话无关动作如 set_theme 缺省 → namespace 全播），
    // CLI 不填——投递路由属 Hub 职责，payload 只描述"做什么"
    SessionEventBaseSchema.extend({
        type: z.literal('ui-command'),
        sessionId: z.string().optional(),
        action: UiCommandActionSchema,
    }),
])

export type SyncEvent = z.infer<typeof SyncEventSchema>
