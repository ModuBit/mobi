# 类型定义 (`types.ts`)

API 层共享的 Zod Schema 和 TypeScript 类型定义。

## 类型来源

```
types.ts
├── 从 @mobi/shared 重新导出
│   ├── AgentState / AgentStateSchema
│   ├── Metadata / MetadataSchema
│   ├── AttachmentMetadata / AttachmentMetadataSchema
│   ├── Session
│   └── ClaudePermissionMode
│
├── 本地定义的 Schema
│   ├── MachineMetadataSchema
│   ├── RunnerStateSchema
│   ├── CliMessagesResponseSchema
│   ├── CreateSessionResponseSchema
│   ├── CreateMachineResponseSchema
│   ├── MessageMetaSchema
│   ├── UserMessageSchema
│   ├── AgentMessageSchema
│   └── MessageContentSchema
│
└── 本地定义的类型
    ├── Machine
    ├── RunnerState
    ├── MachineMetadata
    ├── Usage (从 claude/types)
    ├── SessionPermissionMode (= PermissionMode)
    ├── SessionModel (= string | null)
    └── 各种 Message 类型
```

## 核心类型

### MachineMetadata

机器的静态描述信息：

```typescript
{
    host: string           // 主机名
    platform: string       // 操作系统平台
    mobiCliVersion: string // CLI 版本
    displayName?: string   // 显示名称
    homeDir: string        // 用户主目录
    mobiHomeDir: string    // ~/.mobi/
    mobiLibDir: string     // mobi 库目录
}
```

### RunnerState

Runner 进程的运行状态：

```typescript
{
    status: 'running' | 'shutting-down' | string
    pid?: number
    httpPort?: number
    startedAt?: number
    shutdownRequestedAt?: number
    shutdownSource?: 'mobile-app' | 'cli' | 'os-signal' | 'unknown' | string
    lastSpawnError?: {
        message: string
        pid?: number
        exitCode?: number | null
        signal?: string | null
        at: number
    } | null
}
```

### Machine

机器资源对象，包含版本化的元数据和状态：

```typescript
{
    id: string
    seq: number
    createdAt / updatedAt: number
    active: boolean
    activeAt: number
    metadata: MachineMetadata | null
    metadataVersion: number          // 乐观锁版本号
    runnerState: RunnerState | null
    runnerStateVersion: number       // 乐观锁版本号
}
```

### 消息类型

```
MessageContent = UserMessage | AgentMessage

UserMessage = {
    role: 'user'
    content: { type: 'text', text: string, attachments?: AttachmentMetadata[] }
    localKey?: string
    meta?: MessageMeta
}

AgentMessage = {
    role: 'agent'
    content: { type: 'output', data: unknown }
    meta?: MessageMeta
}
```

### MessageMeta

消息元数据，携带发送来源和 Agent 配置：

```typescript
{
    sentFrom?: string              // 发送来源 ('cli' | 'web')
    fallbackModel?: string | null
    customSystemPrompt?: string | null
    appendSystemPrompt?: string | null
    allowedTools?: string[] | null
    disallowedTools?: string[] | null
}
```

### API 响应 Schema

| Schema | 用途 |
|--------|------|
| `CreateSessionResponseSchema` | `POST /cli/sessions` 响应 |
| `CreateMachineResponseSchema` | `POST /cli/machines` 响应 |
| `CliMessagesResponseSchema` | `GET /cli/sessions/:id/messages` 响应 |

所有 API 响应 Schema 用于运行时校验 Hub 返回的数据结构。

## Schema 策略

- **shared 包复用**: AgentState、Metadata 等核心类型从 `@mobi/shared` 导入
- **本地扩展**: Machine/Runner 相关类型在 CLI 侧独立定义
- **宽松校验**: `z.unknown().nullable()` 处理 Hub 可能为空的字段
- **联合类型**: `status` 等字段使用 `z.enum([...]) | z.string()` 前向兼容
