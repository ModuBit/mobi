# API 共享类型

各 API 端点共用的类型定义，源码位于 `packages/shared/src/schemas.ts`、`packages/shared/src/modes.ts` 和 `packages/shared/src/sessionSummary.ts`。

## 权限与模式

### PermissionMode

权限模式，控制 CLI 的自动审批行为。

**源码**: `packages/shared/src/modes.ts`

```typescript
type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan'
```

| 值 | 含义 | 标签 | 语义色 |
|---|------|------|--------|
| `default` | 默认模式，每次操作都需确认 | Default | neutral |
| `acceptEdits` | 自动接受编辑操作 | Accept Edits | warning |
| `bypassPermissions` | 跳过所有权限检查 | Yolo | danger |
| `plan` | 计划模式，只规划不执行 | Plan Mode | success |

### PermissionModeTone

语义颜色，用于前端展示不同权限模式的风险等级。

**源码**: `packages/shared/src/modes.ts`

```typescript
type PermissionModeTone = 'neutral' | 'info' | 'warning' | 'danger' | 'success'
```

### PermissionModeOption

权限模式选项（含标签和语义色），用于前端渲染选择器。

**源码**: `packages/shared/src/modes.ts`

```typescript
interface PermissionModeOption {
    mode: PermissionMode
    label: string        // 显示名称
    tone: PermissionModeTone
}
```

### EffortLevel

Agent 思考投入级别。

**源码**: `packages/shared/src/modes.ts`

```typescript
type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh'
```

| 值 | 标签 |
|---|------|
| `low` | Low |
| `medium` | Medium |
| `high` | High |
| `xhigh` | X-High |

### ClaudePermissionMode

Claude Code 原生权限模式枚举，值与 `PermissionMode` 相同。

**源码**: `packages/shared/src/modes.ts`

```typescript
type ClaudePermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan'
```

### ClaudeModelPreset

Claude 模型预设。

**源码**: `packages/shared/src/modes.ts`

```typescript
type ClaudeModelPreset = 'sonnet' | 'sonnet[1m]' | 'opus' | 'opus[1m]'
```

### AgentFlavor

Agent 类型标识，当前仅支持 Claude。

**源码**: `packages/shared/src/modes.ts`

```typescript
type AgentFlavor = 'claude'
```

## 消息与附件

### DecryptedMessage

已解密的消息，客户端发送或服务端存储的消息格式。

**源码**: `packages/shared/src/schemas.ts`

```typescript
interface DecryptedMessage {
    id: string            // 消息唯一 ID
    seq: number | null    // 服务端序号（持久化后分配），null 表示尚未入库
    localId: string | null // 客户端本地 ID（用于去重）
    content: unknown      // 消息内容（SDK 原始格式）
    createdAt: number     // 创建时间戳（毫秒）
    snapshot?: boolean    // 标识流式快照消息（未落库，Hub 直接透传给 Web）
}
```

### AttachmentMetadata

附件元数据，描述上传文件的信息。

**源码**: `packages/shared/src/schemas.ts`

```typescript
interface AttachmentMetadata {
    id: string            // 附件唯一 ID
    filename: string      // 文件名
    mimeType: string      // MIME 类型，如 "image/png"
    size: number          // 文件大小（字节）
    path: string          // 服务端存储路径
    previewUrl?: string   // 预览 URL（图片等可预览文件）
}
```

## 会话

### Session

Agent 会话，对应 CLI 的一次运行实例。

**源码**: `packages/shared/src/schemas.ts`

```typescript
interface Session {
    id: string              // 会话 ID
    namespace: string       // 命名空间（对应 CLI 所在目录）
    seq: number             // 版本号（乐观锁）
    createdAt: number       // 创建时间
    updatedAt: number       // 最后更新时间
    active: boolean         // 是否活跃（仅内存，不持久化）
    activeAt: number        // 最后活跃时间
    metadata: Metadata | null  // 会话元数据（名称、工作目录等）
    metadataVersion: number // 元数据版本号
    agentState: AgentState | null // Agent 状态
    agentStateVersion: number
    running: boolean        // Agent 是否在运行中
    runningAt: number       // 最后运行时间
    runtimeState?: RuntimeState // 运行时状态（todos、model 等）
    permissionMode?: PermissionMode
    mode?: 'local' | 'remote' // 会话模式
    groupKey?: string       // 分组键（用于会话分组）
    tag?: string | null     // 标签（用于 getOrCreateSession 复用）
}
```

### SessionSummary

会话摘要，用于列表展示，由 `toSessionSummary()` 从 `Session` 派生。

**源码**: `packages/shared/src/sessionSummary.ts`

```typescript
interface SessionSummary {
    id: string
    active: boolean
    running: boolean
    activeAt: number
    updatedAt: number
    metadata: SessionSummaryMetadata | null
    todoProgress: { completed: number; total: number } | null
    taskProgress: { completed: number; total: number } | null
    pendingRequestsCount: number
    model?: string | null
    mode?: 'local' | 'remote'
}
```

### SessionSummaryMetadata

会话摘要中的精简元数据。

**源码**: `packages/shared/src/sessionSummary.ts`

```typescript
interface SessionSummaryMetadata {
    name?: string
    path: string
    machineId?: string
    summary?: { text: string }
    flavor?: string | null
    worktree?: WorktreeMetadata
}
```

## 事件

### SyncEvent

SyncEngine 产生的事件，用于组件间通信。

**源码**: `packages/shared/src/schemas.ts`

```typescript
type SyncEvent =
    | { type: 'session-added', sessionId: string, data?: unknown, namespace?: string }
    | { type: 'session-updated', sessionId: string, data?: unknown, namespace?: string }
    | { type: 'session-removed', sessionId: string, namespace?: string }
    | { type: 'message-received', sessionId: string, message: DecryptedMessage, namespace?: string }
    | { type: 'machine-updated', machineId: string, data?: unknown, namespace?: string }
    | { type: 'toast', data: { title: string, body: string, sessionId: string, url: string, kind: 'ready' | 'permission' }, namespace?: string }
    | { type: 'message-snapshot', sessionId: string, message: DecryptedMessage, namespace?: string }
    | { type: 'heartbeat', data?: { timestamp: number }, namespace?: string }
    | { type: 'connection-changed', data?: { status: string, subscriptionId?: string }, connected?: boolean, reconnected?: boolean, namespace?: string }
    | { type: 'idle-timeout-warning', sessionId: string, data: { timeoutAt: number, remainingMs: number }, namespace?: string }
```

| 事件类型 | 触发场景 |
|---------|---------|
| `session-added` | 新会话首次加载到内存缓存 |
| `session-updated` | 会话状态变化（活跃/思考/配置等） |
| `session-removed` | 会话从缓存/数据库中删除 |
| `message-received` | 收到新消息 |
| `machine-updated` | 机器状态变化（上线/离线/心跳） |
| `toast` | 需要展示 Toast 通知（`kind: 'ready'` = Agent 等待输入，`kind: 'permission'` = CLI 请求权限） |
| `message-snapshot` | 流式快照消息（未落库，Hub 直接透传给 Web） |
| `heartbeat` | 心跳事件 |
| `connection-changed` | 连接状态变化 |
| `idle-timeout-warning` | 空闲超时预警，提示会话即将因空闲被关闭 |

## 会话元数据

### Metadata

会话元数据，包含 CLI 环境和 SDK 信息。

**源码**: `packages/shared/src/schemas.ts`

```typescript
interface Metadata {
    path: string                     // 工作目录
    host: string                     // 主机名
    version?: string                 // CLI 版本
    name?: string                    // 会话名称
    os?: string                      // 操作系统
    summary?: { text: string, updatedAt: number } // 会话摘要
    machineId?: string               // 机器唯一 ID
    claudeSessionId?: string         // Claude 原生会话 ID
    tools?: string[]                 // 可用工具列表
    sdkMetadata?: SDKMetadata        // SDK 元数据
    homeDir?: string                 // 用户主目录
    mobiHomeDir?: string             // Mobi 主目录
    mobiLibDir?: string              // Mobi 库目录
    mobiToolsDir?: string            // Mobi 工具目录
    startedFromRunner?: boolean      // 是否由 Runner 启动
    hostPid?: number                 // 主进程 PID
    startedBy?: 'runner' | 'terminal' // 启动来源
    lifecycleState?: string          // 生命周期状态
    lifecycleStateSince?: number     // 生命周期状态变更时间
    archivedBy?: string              // 归档操作者
    archiveReason?: string           // 归档原因
    flavor?: string | null           // Agent 类型
    worktree?: WorktreeMetadata      // Git Worktree 信息
    gitBranch?: string               // Git 当前分支
}
```

### WorktreeMetadata

Git Worktree 元数据。

**源码**: `packages/shared/src/schemas.ts`

```typescript
interface WorktreeMetadata {
    basePath: string
    branch: string
    name: string
    worktreePath?: string
    createdAt?: number
}
```

## SDK 元数据

SDK 相关的元信息，来自 CLI 的 `initializationResult`。

**源码**: `packages/shared/src/schemas.ts`

### SlashCommand

SDK 斜杠命令信息。

```typescript
interface SlashCommand {
    name: string
    description: string
    argumentHint: string
}
```

### AgentInfo

SDK 子代理信息。

```typescript
interface AgentInfo {
    name: string
    description: string
    model?: string
}
```

### ModelInfo

SDK 模型信息。

```typescript
interface ModelInfo {
    value: string
    displayName: string
    description: string
}
```

### AccountInfo

SDK 账户信息。

```typescript
interface AccountInfo {
    email?: string
    organization?: string
    subscriptionType?: string
    tokenSource?: string
    apiKeySource?: string
    apiProvider?: 'firstParty' | 'bedrock' | 'vertex' | 'foundry' | 'anthropicAws' | 'mantle' | 'gateway'
}
```

### FastModeState

SDK 快速模式状态。

```typescript
type FastModeState = 'off' | 'cooldown' | 'on'
```

### SDKMetadata

SDK 元数据聚合。

```typescript
interface SDKMetadata {
    commands?: SlashCommand[]
    agents?: AgentInfo[]
    outputStyle?: string
    availableOutputStyles?: string[]
    models?: ModelInfo[]
    account?: AccountInfo
    fastModeState?: FastModeState
}
```

## Agent 状态

### AgentState

Agent 状态，表示当前是否受用户控制以及等待处理的请求。

**源码**: `packages/shared/src/schemas.ts`

```typescript
interface AgentState {
    controlledByUser?: boolean | null
    requests?: Record<string, AgentStateRequest> | null
}
```

### AgentStateRequest

Agent 等待中的请求（如权限确认）。

**源码**: `packages/shared/src/schemas.ts`

```typescript
interface AgentStateRequest {
    tool: string
    arguments: unknown
    createdAt?: number | null
    sdkHints?: SDKUIHints
}
```

### SDKUIHints

SDK UI 提示信息。

**源码**: `packages/shared/src/schemas.ts`

```typescript
interface SDKUIHints {
    title?: string
    displayName?: string
    description?: string
    decisionReason?: string
    blockedPath?: string
    agentID?: string
    agentDescription?: string
    agentSubagentType?: string
}
```

## 运行时状态

### RuntimeState

运行时状态，存储会话的扩展状态（todos、teamState、model 等）。未来新增功能可在此对象中添加字段，无需修改数据库 schema。

**源码**: `packages/shared/src/schemas.ts`

```typescript
interface RuntimeState {
    todos?: TodoItem[]
    tasks?: TaskItem[]
    backgroundTasks?: BackgroundTaskItem[]
    teamState?: TeamState
    model?: string | null
    effort?: EffortLevel
}
```

### TodoItem

待办事项。

**源码**: `packages/shared/src/schemas.ts`

```typescript
interface TodoItem {
    content: string
    status: 'pending' | 'in_progress' | 'completed'
    activeForm: string
}
```

### TaskItem

任务项。

**源码**: `packages/shared/src/schemas.ts`

```typescript
interface TaskItem {
    id: string
    subject: string
    description?: string
    status: 'pending' | 'in_progress' | 'completed' | 'deleted'
    activeForm?: string
    owner?: string
    metadata?: Record<string, unknown>
}
```

### BackgroundTaskItem

后台任务项。

**源码**: `packages/shared/src/schemas.ts`

```typescript
interface BackgroundTaskItem {
    taskId: string
    toolUseId?: string | null
    toolName: 'Bash' | 'Agent' | 'Monitor'
    description: string
    subagentType?: string
    status: 'running' | 'completed' | 'failed' | 'stopped'
    metrics?: {
        tokens: number
        toolUses: number
        durationMs: number
    }
    summary?: string
    startedAt: number
    completedAt?: number
}
```

## Team

Team（多代理协作）相关类型。

**源码**: `packages/shared/src/schemas.ts`

### TeamState

Team 整体状态。

```typescript
interface TeamState {
    teamName: string
    description?: string
    members?: TeamMember[]
    tasks?: TeamTask[]
    messages?: TeamMessage[]
    updatedAt?: number
}
```

### TeamMember

Team 成员。

```typescript
interface TeamMember {
    name: string
    agentId?: string
    agentType?: string
    status?: 'active' | 'idle' | 'shutdown' | 'running' | 'completed'
    prompt?: string
    startedAt?: number
    lastProgressAt?: number
    taskIds?: string[]
}
```

### TeamTask

Team 任务。

```typescript
interface TeamTask {
    id: string
    title?: string
    subject?: string
    description?: string
    status?: 'pending' | 'in_progress' | 'completed' | 'blocked' | 'deleted'
    owner?: string
    createdAt?: number
}
```

### TeamMessage

Team 内部消息。

```typescript
interface TeamMessage {
    from: string
    to: string
    summary: string
    type: 'message' | 'broadcast' | 'shutdown_request' | 'shutdown_response'
    timestamp: number
}
```
