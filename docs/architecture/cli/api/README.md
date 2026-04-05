# API 通信层 (`cli/src/api/`)

CLI 与 Hub 之间的双向通信层，承载 Session / Machine 的生命周期管理、消息同步和 RPC 调用。

## 架构总览

```
┌──────────────────────────────────────────────────────────────┐
│                     cli/src/api/                              │
│                                                              │
│  ┌──────────┐  HTTP  ┌─────────────────┐                    │
│  │ ApiClient │──────▶│ Hub REST API     │                    │
│  │ (api.ts)  │       │ /cli/sessions    │                    │
│  │           │       │ /cli/machines    │                    │
│  └─────┬─────┘       └──────────────────┘                    │
│        │ factory                                             │
│        ├───────────┐                                         │
│        │           │                                         │
│  ┌─────▼─────┐ ┌───▼──────────────┐                         │
│  │ApiSession │ │ ApiMachineClient  │  Socket.IO              │
│  │  Client   │ │ (apiMachine.ts)   │─────────▶ Hub WS        │
│  │(apiSession│ │                   │  /cli namespace          │
│  │  .ts)     │ │  Machine RPC      │  machine-scoped          │
│  │           │ │  spawnSession     │                          │
│  │ Session   │ │  stopSession      │                          │
│  │ 消息同步   │ │  pathExists       │                          │
│  │ Terminal  │ │  stopRunner       │                          │
│  │ Backfill  │ └───────────────────┘                          │
│  │ Session RPC│                                                 │
│  └─────┬─────┘                                                │
│        │                                                      │
│  ┌─────▼──────────────────────┐                               │
│  │        rpc/                 │  通用 RPC 基础设施             │
│  │  RpcHandlerManager          │  方法注册 + 请求分发           │
│  │  types (RpcHandler等)       │                               │
│  └────────────────────────────┘                               │
│                                                              │
│  ┌────────────────┐ ┌──────────────────┐                     │
│  │ auth.ts        │ │ socketOutbox.ts  │                     │
│  │ Token 获取     │ │ 离线消息队列     │                     │
│  └────────────────┘ └──────────────────┘                     │
│                                                              │
│  ┌────────────────┐ ┌──────────────────┐                     │
│  │ types.ts       │ │ versionedUpdate  │                     │
│  │ Schema & Type  │ │ .ts              │                     │
│  │ 统一定义       │ │ 乐观锁版本控制   │                     │
│  └────────────────┘ └──────────────────┘                     │
└──────────────────────────────────────────────────────────────┘
```

## 文件清单

| 文件 | 职责 | 通信方式 | 详细文档 |
|------|------|---------|---------|
| `api.ts` | ApiClient 工厂，HTTP 资源创建 | HTTP REST | [api-client.md](./api-client.md) |
| `apiSession.ts` | Session 级 Socket.IO 客户端 | WebSocket | [api-session.md](./api-session.md) |
| `apiMachine.ts` | Machine 级 Socket.IO 客户端 | WebSocket | [api-machine.md](./api-machine.md) |
| `types.ts` | 共享 Schema 和类型定义 | - | [types.md](./types.md) |
| `auth.ts` | Auth Token 获取 | - | 内联（极简，仅从 configuration 读取 token） |
| `versionedUpdate.ts` | 乐观锁版本化更新协议 | - | [versioned-update.md](./versioned-update.md) |
| `socketOutbox.ts` | Socket 离线消息缓冲队列 | - | [socket-outbox.md](./socket-outbox.md) |
| `rpc/RpcHandlerManager.ts` | RPC 方法注册与分发 | - | [rpc.md](./rpc.md) |
| `rpc/types.ts` | RPC 类型定义 | - | 同上 |

## 通信协议

### HTTP（REST）

- `GET /cli/sessions/by-claude-session/:id` — 按 Claude Session ID 查找 session
- `POST /cli/sessions` — 创建或获取 session
- `POST /cli/machines` — 创建或获取 machine
- `GET /cli/sessions/:id/messages` — 消息回填

### WebSocket（Socket.IO）

所有 WS 连接挂载到 `/cli` namespace，通过 `clientType` 区分身份：

| clientType | 用途 | 标识 |
|------------|------|------|
| `session-scoped` | 会话消息同步 | `sessionId` |
| `machine-scoped` | 机器管理与 RPC | `machineId` |

### RPC

基于 Socket.IO `rpc-request` 事件的双向调用机制，方法名按 `{scopePrefix}:{method}` 格式。

## 调用关系

```
runner/run.ts ──────▶ ApiClient ──▶ ApiMachineClient (machine WebSocket)
                         │
agent/sessionFactory ──▶│
                         └────▶ ApiSessionClient (session WebSocket)
                                       │
agent/loop.ts ◀──────────────────────────┘ (通过 ApiSessionClient 接收用户消息)
```

- **ApiClient** 是工厂入口，负责 HTTP 资源创建 + 工厂方法
- **ApiMachineClient** 由 Runner 持有，管理机器级生命周期
- **ApiSessionClient** 由每个 Claude Session 持有，负责消息双向同步
