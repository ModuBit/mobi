# API 共享类型

各 API 端点共用的类型定义，源码位于 `packages/shared/src/schemas.ts` 和 `packages/shared/src/modes.ts`。

## PermissionMode

权限模式，控制 CLI 的自动审批行为。

**源码**: `packages/shared/src/modes.ts`

```typescript
type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan'
```

| 值 | 含义 | 标签 | 语义 |
|---|------|------|------|
| `default` | 默认模式，每次操作都需确认 | Default | neutral |
| `acceptEdits` | 自动接受编辑操作 | Accept Edits | warning |
| `bypassPermissions` | 跳过所有权限检查 | Yolo | danger |
| `plan` | 计划模式，只规划不执行 | Plan Mode | info |

**相关类型**：

```typescript
// 语义颜色，用于前端展示不同权限模式的风险等级
type PermissionModeTone = 'neutral' | 'info' | 'warning' | 'danger'

// 权限模式选项（含标签和语义色），用于前端渲染选择器
type PermissionModeOption = {
    mode: PermissionMode
    label: string        // 显示名称
    tone: PermissionModeTone
}
```

## DecryptedMessage

已解密的消息，客户端发送或服务端存储的消息格式。

**源码**: `packages/shared/src/schemas.ts`

```typescript
interface DecryptedMessage {
    id: string            // 消息唯一 ID
    seq: number | null    // 服务端序号（持久化后分配），null 表示尚未入库
    localId: string | null // 客户端本地 ID（用于去重）
    content: unknown      // 消息内容（SDK 原始格式）
    createdAt: number     // 创建时间戳（毫秒）
}
```

## AttachmentMetadata

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

## Session

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
    metadata: {...} | null  // 会话元数据（名称、工作目录等）
    metadataVersion: number // 元数据版本号
    agentState: {...} | null // Agent 状态
    agentStateVersion: number
    thinking: boolean       // Agent 是否在思考中（仅内存）
    thinkingAt: number      // 最后思考时间
    runtimeState?: {...}    // 运行时状态（模型、账户等）
    permissionMode?: PermissionMode
    groupKey?: string       // 分组键（用于会话分组）
    tag?: string | null     // 标签（用于 getOrCreateSession 复用）
}
```

## SyncEvent

SyncEngine 产生的事件，用于组件间通信。

**源码**: `packages/shared/src/schemas.ts`

```typescript
type SyncEvent =
    | { type: 'session-added', sessionId: string, data?: unknown }
    | { type: 'session-updated', sessionId: string, data?: unknown }
    | { type: 'session-removed', sessionId: string }
    | { type: 'message-received', sessionId: string, message: DecryptedMessage }
    | { type: 'machine-updated', machineId: string, data?: unknown }
    | { type: 'toast', data: { title: string, body: string, sessionId: string, url: string } }
    | { type: 'heartbeat', data?: { timestamp: number } }
    | { type: 'connection-changed', data: { ... } }
```

| 事件类型 | 触发场景 |
|---------|---------|
| `session-added` | 新会话首次加载到内存缓存 |
| `session-updated` | 会话状态变化（活跃/思考/配置等） |
| `session-removed` | 会话从缓存/数据库中删除 |
| `message-received` | 收到新消息 |
| `machine-updated` | 机器状态变化（上线/离线/心跳） |
| `toast` | 需要展示 Toast 通知 |
| `heartbeat` | 心跳事件 |
| `connection-changed` | 连接状态变化 |
