# API 通信层 (`packages/session/src/api/`)

CLI 会话子进程与 daemon 之间的双向通信层，承载 Session 生命周期管理、消息同步和 RPC 调用。

## 架构总览

```
┌──────────────────────────────────────────────────────────────┐
│                     packages/session/src/api/                 │
│                                                              │
│  ┌──────────────────┐  HTTP  ┌──────────────────┐            │
│  │ ApiClient         │──────▶│ daemon REST API   │            │
│  │ (node-core        │       │ /cli/sessions     │            │
│  │  api/api.ts)      │       └──────────────────┘            │
│  └─────┬────────────┘                                        │
│        │ factory                                             │
│  ┌─────▼────────────┐     Socket.IO                         │
│  │ ApiSessionClient │─────────▶ daemon WS                    │
│  │ (apiSession.ts)  │           /cli namespace               │
│  │                  │           session-scoped               │
│  │ Session 消息同步  │                                        │
│  │ Terminal         │                                        │
│  │ Backfill         │                                        │
│  │ Session RPC      │                                        │
│  └─────┬────────────┘                                        │
│        │                                                     │
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
| `apiSession.ts`（session 包） | Session 级 Socket.IO 客户端 | WebSocket | [api-session.md](./api-session.md) |
| `api.ts`（node-core） | HTTP 客户端，资源创建 | HTTP REST | [api-client.md](./api-client.md) |
| `types.ts`（node-core） | 共享 Schema 和类型定义 | - | [types.md](./types.md) |
| `auth.ts`（node-core） | Auth Token 获取 | - | 内联（极简，仅从 configuration 读取 token） |
| `versionedUpdate.ts`（node-core） | 乐观锁版本化更新协议 | - | [versioned-update.md](./versioned-update.md) |
| `rpc/RpcHandlerManager.ts`（node-core） | RPC 方法注册与分发 | - | [rpc.md](./rpc.md) |
| `rpc/types.ts`（node-core） | RPC 类型定义 | - | 同上 |

> `socketOutbox.ts`（Socket 离线消息缓冲队列，预留设施）已随 machine 通道退场删除，历史设计见 [socket-outbox.md](./socket-outbox.md)。

## 通信协议

### HTTP（REST）

- `GET /cli/sessions/by-claude-session/:id` — 按 Claude Session ID 查找 session
- `POST /cli/sessions` — 创建或获取 session
- `GET /cli/sessions/:id/messages` — 消息回填

### WebSocket（Socket.IO）

所有 WS 连接挂载到 `/cli` namespace，`clientType: 'session-scoped'`，以 `sessionId` 标识。

### RPC

基于 Socket.IO `rpc-request` 事件的双向调用机制，方法名按 `{scopePrefix}:{method}` 格式。

## 调用关系

```
agent/sessionFactory ──▶ ApiClient (HTTP 创建/查找 session)
        │
        └────▶ ApiSessionClient (session WebSocket)
                     │
agent/loop.ts ◀──────┘ (通过 ApiSessionClient 接收用户消息)
```

- **ApiClient**（node-core）负责 HTTP 资源创建
- **ApiSessionClient** 由每个 Claude Session 持有，负责消息双向同步
