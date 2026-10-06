# 类型定义 (`packages/node-core/src/api/types.ts`)

API 层共享的 Zod Schema 和 TypeScript 类型定义。

## 类型来源

```
types.ts
├── 从 @mobi/shared 重新导出
│   ├── AgentState / AgentStateSchema
│   ├── Metadata / MetadataSchema
│   ├── Workspace / WorkspaceSchema
│   ├── HostMetadata（from shared/hostProtocol）
│   ├── ExecutorState（from shared/hostProtocol）
│   ├── Session
│   └── ClaudePermissionMode
│
├── 本地定义的 Schema
│   ├── CliMessagesResponseSchema
│   ├── CreateSessionResponseSchema
│   ├── MessageMetaSchema
│   ├── UserMessageSchema
│   ├── AgentMessageSchema
│   └── MessageContentSchema
│
└── 本地定义的类型
    ├── Usage (从 shared/schemas)
    ├── SessionPermissionMode (= PermissionMode)
    ├── SessionModel (= string | null)
    └── 各种 Message 类型
```

> 历史上的 `Machine` / `MachineMetadata` / `RunnerState` 本地类型已随 machine 概念移除删除：宿主静态描述收敛为 shared `HostMetadata`，executor 运行状态收敛为 shared `ExecutorState`（daemon 内存单例持有，不再落库）。

## 消息类型

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
| `CliMessagesResponseSchema` | `GET /cli/sessions/:id/messages` 响应 |

所有 API 响应 Schema 用于运行时校验 daemon 返回的数据结构。

## Schema 策略

- **shared 包复用**: AgentState、Metadata 等核心类型从 `@mobi/shared` 导入
- **宽松校验**: `z.unknown().nullable()` 处理 daemon 可能为空的字段
- **联合类型**: `status` 等字段使用 `z.enum([...]) | z.string()` 前向兼容
