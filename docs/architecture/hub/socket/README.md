# SocketServer

**文件**: [`packages/hub/src/socket/server.ts`](/packages/hub/src/socket/server.ts)

SocketServer 是 Hub 的实时通信层，基于 Socket.IO，负责 CLI 客户端和 Web 前端之间的双向实时通信。

## 整体架构

```mermaid
flowchart TB
    CLI[CLI 客户端]
    Web[Web 浏览器]

    subgraph SocketServer
        Engine[Bun Engine<br/>@socket.io/bun-engine]
        IO[Socket.IO Server]

        subgraph cliNs["/cli namespace"]
            CliAuth[API Token 认证]
            CliHandlers[会话 / 机器 / RPC / 终端]
        end

        subgraph termNs["/terminal namespace"]
            TermAuth[JWT 认证]
            TermHandlers[终端代理]
        end
    end

    CLI -->|API Token| cliNs
    Web -->|JWT| termNs
    Engine --> IO
```

两个 namespace 隔离了不同客户端类型的连接和认证逻辑：

| Namespace | 客户端 | 认证方式 | 用途 |
|-----------|--------|----------|------|
| `/cli` | CLI 客户端 | API Token | 会话心跳、消息同步、状态更新、RPC、终端控制 |
| `/terminal` | Web 浏览器 | JWT | 终端输入/输出代理 |

## 事件总览

### /cli namespace

CLI 连接后，通过事件与 Hub 交互。事件按职责分为四组：

**会话事件**（`sessionHandlers.ts`）

| 事件 | 方向 | 说明 |
|------|------|------|
| `message` | CLI → Hub | 发送消息，存入数据库并广播给同房间客户端 |
| `session-alive` | CLI → Hub | 会话心跳，保活状态 |
| `session-end` | CLI → Hub | 会话结束，触发清理 |
| `update-metadata` | CLI ⇄ Hub | 更新会话元数据（名称等），带乐观锁 |
| `update-state` | CLI ⇄ Hub | 更新 Agent 状态（requests 等），带乐观锁 |
| `idle-timeout-warning` | CLI → Hub | 空闲超时预警，广播到 Web 端 |

**机器事件**（`machineHandlers.ts`）

| 事件 | 方向 | 说明 |
|------|------|------|
| `machine-alive` | CLI → Hub | 机器心跳，保活在线状态 |
| `machine-update-metadata` | CLI ⇄ Hub | 更新机器元数据 |
| `machine-update-state` | CLI ⇄ Hub | 更新 Runner 状态 |

**RPC 事件**（`rpcHandlers.ts`）

| 事件 | 方向 | 说明 |
|------|------|------|
| `rpc-register` | CLI → Hub | 注册 RPC 方法 |
| `rpc-unregister` | CLI → Hub | 注销 RPC 方法 |

Hub 通过 `rpc-request` 事件调用 CLI 的 RPC 方法，用于 Web 端发起的权限操作、文件操作等。详见 [RPC 框架](./rpc.md)。

**终端事件（CLI 端）**（`terminalHandlers.ts`）

| 事件 | 方向 | 说明 |
|------|------|------|
| `terminal:ready` | CLI → Hub | 终端就绪 |
| `terminal:output` | CLI → Hub | 终端输出 |
| `terminal:exit` | CLI → Hub | 终端退出 |
| `terminal:error` | CLI → Hub | 终端错误 |

各事件的详细处理流程见 [事件处理器架构](./handlers.md)。

### /terminal namespace

Web 端通过此 namespace 代理终端 I/O：

| 事件 | 方向 | 说明 |
|------|------|------|
| `terminal:create` | Web → Hub | 创建终端，转发给 CLI |
| `terminal:write` | Web → Hub | 终端输入，转发给 CLI |
| `terminal:resize` | Web → Hub | 终端大小变更，转发给 CLI |
| `terminal:close` | Web → Hub | 关闭终端 |

终端数据流：Web ↔ `/terminal` ↔ Hub ↔ `/cli` ↔ CLI，不经过 SyncEngine。详见 [事件处理器架构](./handlers.md) 和 [终端代理](./terminal.md)。

## 核心机制

### 认证

两个 namespace 使用不同的认证策略：

```mermaid
flowchart LR
    subgraph "/cli"
        CLI[CLI 客户端] -->|auth.token| Parse[parseAccessToken]
        Parse --> Compare[constantTimeEquals<br/>与 CLI_API_TOKEN 比较]
        Compare -->|通过| Join[加入房间]
    end

    subgraph "/terminal"
        Web[Web 浏览器] -->|auth.token| Verify[jwtVerify<br/>HS256 验签]
        Verify -->|通过| ParsePayload[解析 uid + namespace]
        ParsePayload --> Join2[连接就绪]
    end
```

- `/cli`：使用 `CLI_API_TOKEN` 做固定令牌认证，通过时间恒定比较防止时序攻击
- `/terminal`：使用 JWT 认证，验证 HS256 签名，提取 `uid` 和 `ns`（namespace）

认证通过后，客户端信息存入 `socket.data`：

```typescript
// /cli namespace
socket.data.namespace = parsedToken.namespace

// /terminal namespace
socket.data.userId = parsed.data.uid
socket.data.namespace = parsed.data.ns
```

### 权限控制

每个事件处理前都会通过 `resolveSessionAccess` 或 `resolveMachineAccess` 检查：

1. namespace 是否匹配（多租户隔离）
2. 资源是否存在
3. 客户端是否有权访问

```mermaid
flowchart TB
    Request[收到请求] --> NS{namespace 存在?}
    NS -->|否| Error1[namespace-missing]
    NS -->|是| Lookup[查询资源]
    Lookup --> Found{找到?}
    Found -->|否| Error2[not-found]
    Found -->|是| Match{namespace 匹配?}
    Match -->|否| Error3[access-denied]
    Match -->|是| Allow[允许访问]
```

### 房间机制

CLI 连接后自动加入房间，用于 Socket.IO 的广播定向：

| 房间 | 加入条件 | 用途 |
|------|----------|------|
| `session:{sessionId}` | auth 中携带 sessionId 且有权限 | 同会话的 CLI 客户端接收 `update` 事件 |
| `machine:{machineId}` | auth 中携带 machineId 且有权限 | 同机器的 CLI 客户端接收 `update` 事件 |

`socket.to(room).emit('update', ...)` 将事件广播给同房间的其他客户端。

### 乐观锁

`update-metadata`、`update-state`、`machine-update-metadata`、`machine-update-state` 四个事件使用乐观锁机制：

- 请求中携带 `expectedVersion`
- 数据库更新时比对版本号
- 成功则递增版本，失败返回 `version-mismatch` 和当前版本

这保证了 CLI 和 Web 并发更新时不会丢失数据。

## RPC 框架

CLI 通过 `rpc-register` 注册 RPC 方法（如权限操作、文件操作），Web 端通过 Hub 调用。

详见 [RpcRegistry](./rpc.md)。

## 终端代理

终端通道在 Web 和 CLI 之间实时双向转发终端 I/O，通过 `TerminalRegistry` 管理终端生命周期。

详见 [终端代理](./terminal.md)。

## 与 SyncEngine 的关系

SocketServer 与 SyncEngine 存在循环引用：

```
SocketServer ←(lazy getter)→ SyncEngine
```

- SocketServer 创建时传入 `getSession`、`onSessionAlive` 等回调，这些回调由 SyncEngine 实现
- SyncEngine 创建时使用 SocketServer 的 `io` 和 `rpcRegistry`

在 `index.ts` 中的解决方式：

```typescript
// SocketServer 先创建，回调中引用 SyncEngine（此时为 null）
const socketServer = createSocketServer({
    getSession: (sessionId) => syncEngine?.getSession(sessionId) ?? null,
    onSessionAlive: (payload) => syncEngine?.handleSessionAlive(payload),
    ...
})

// SyncEngine 后创建，使用 SocketServer 的 io 和 rpcRegistry
syncEngine = new SyncEngine(store, socketServer.io, socketServer.rpcRegistry, sseManager)
```

### 事件转发链路

```mermaid
flowchart LR
    CLI[CLI] -->|Socket.IO| Socket[SocketServer]
    Socket -->|回调| SE[SyncEngine]
    SE -->|broadcast| SSE[SSEManager]
    SSE -->|SSE| Web[Web 客户端]
```

CLI → SocketServer（通过回调）→ SyncEngine → SSEManager → Web

## 代码结构

```
packages/hub/src/socket/
├── server.ts                  # 入口：创建 Socket.IO Server，配置 namespace
├── socketTypes.ts             # 类型定义：SocketData、SocketServer 等
├── rpcRegistry.ts             # RPC 方法注册表
├── terminalRegistry.ts        # 终端注册表，管理终端生命周期
└── handlers/
    ├── terminal.ts            # /terminal namespace 处理器
    └── cli/
        ├── index.ts           # /cli 入口：注册所有 CLI 处理器
        ├── types.ts           # 访问控制类型：AccessResult
        ├── sessionHandlers.ts # 会话事件处理器
        ├── machineHandlers.ts # 机器事件处理器
        ├── rpcHandlers.ts     # RPC 注册/注销处理器
        └── terminalHandlers.ts # 终端事件处理器（CLI 端）
```

## 配置项

| 环境变量 | 默认值 | 说明 |
|----------|--------|------|
| `MOBI_TERMINAL_IDLE_TIMEOUT_MS` | 900000 (15min) | 终端空闲超时时间 |
| `MOBI_TERMINAL_MAX_TERMINALS` | 4 | 每个 socket/session 最大终端数 |
