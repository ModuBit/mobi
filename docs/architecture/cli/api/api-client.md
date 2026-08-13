# ApiClient (`api.ts`)

HTTP 客户端工厂，负责向 Hub REST API 创建/查找 Session 和 Machine 资源。

## 核心职责

- Token 认证的 HTTP 请求封装
- Session / Machine 资源的创建与查找
- 作为 `ApiSessionClient` 和 `ApiMachineClient` 的工厂入口

## 类结构

```
ApiClient
├── static create()            // 异步工厂，自动获取 auth token
├── getSessionByClaudeSessionId(claudeSessionId)  // 按 Claude Session ID 查找
├── getOrCreateSession(opts)   // 创建或获取 session
├── getOrCreateMachine(opts)   // 创建或获取 machine
├── sessionSyncClient(session) // 工厂：创建 ApiSessionClient
└── machineSyncClient(machine) // 工厂：创建 ApiMachineClient
```

## API 端点

### `getSessionByClaudeSessionId(claudeSessionId)`

```
GET /cli/sessions/by-claude-session/:claudeSessionId
```

- **用途**: CLI `--resume` 模式下，根据 Claude 原生 session ID 查找已存在的 mobi session
- **错误处理**: 404 返回 `null`（session 不存在），其他错误降级为 `null` + debug 日志
- **响应验证**: 使用 `CreateSessionResponseSchema` 校验，失败降级为 `null`
- **元数据解析**: metadata / agentState 独立校验，任一失败不影响另一字段

### `getOrCreateSession(opts)`

```
POST /cli/sessions
Body: { tag, metadata, agentState, mode?, runtimeState?, projectId? }
```

- **用途**: 创建新 session 或获取已有 session（Hub 端按 tag 幂等）
- **参数**:
  - `tag`: session 标签（用于 `--resume` 复用）
  - `metadata`: 机器/路径信息
  - `agentState`: Agent 状态快照
  - `projectId`: 归属项目 id（`--project` 透传；Hub 校验项目归属本机，404/403 时报错）
- **返回**: `Session & { project: Project | null }`——`project` 为归属项目实体（游离时 `null`），CLI 据此派生并冻结 `metadata.additionalDirectories`
- **错误处理**: 响应校验失败抛出 `apiValidationError`

### `getOrCreateMachine(opts)`

```
POST /cli/machines
Body: { id, metadata, runnerState }
```

- **用途**: 注册或更新机器信息
- **参数**:
  - `id`: 机器唯一标识（hostname-based）
  - `metadata`: 机器元数据（host, platform, version 等）
  - `runnerState`: Runner 运行状态

## 响应解析模式

所有 API 方法共享统一的响应解析模式：

```typescript
// 1. Zod Schema 校验原始响应
const parsed = SomeSchema.safeParse(response.data)

// 2. metadata / agentState / runnerState 独立解析
// 任何字段解析失败不影响其他字段

// 3. 返回类型化的对象
```

这种模式确保：
- Hub 响应格式变更不会导致整个请求失败
- 不认识的字段被安全忽略
- 日志记录所有解析失败

## 调用者

| 调用者 | 用途 |
|--------|------|
| `runner/run.ts` | Runner 启动时注册 Machine |
| `agent/sessionFactory.ts` | 启动 Claude Session 前创建/查找 Session |

## 设计要点

1. **异步工厂**: `create()` 是 async 的，因为 token 获取可能涉及 I/O
2. **私有构造**: 构造函数私有，强制通过 `create()` 创建实例
3. **降级优先**: `getSessionByClaudeSessionId` 在任何错误时返回 `null`，调用者会创建新 session
4. **超时控制**: 查询 10s，写入 60s
