# RPC 框架

**文件**: [`packages/hub/src/socket/rpcRegistry.ts`](/packages/hub/src/socket/rpcRegistry.ts)

RpcRegistry 管理 CLI 注册的 RPC 方法，使 Web 端可以通过 Hub 远程调用 CLI 的方法。

## 架构

```mermaid
flowchart LR
    Web[Web 端] -->|HTTP API| Hub[Hub Server]
    Hub -->|rpc-request| Registry[RpcRegistry]
    Registry -->|method → socketId| CLI[CLI Socket]
    CLI -->|callback| Hub -->|response| Web
```

## 数据结构

RpcRegistry 维护两个双向索引：

```
methodToSocketId:   Map<method, socketId>     // 方法名 → CLI socket ID
socketIdToMethods:  Map<socketId, Set<method>> // CLI socket ID → 方法集合
```

通过双向索引可以：
- `getSocketIdForMethod(method)` — 快速查找提供某方法的 CLI socket
- `unregisterAll(socket)` — CLI 断开时批量清理所有注册的方法

## RPC 方法注册流程

```mermaid
sequenceDiagram
    participant CLI
    participant Hub as SocketServer
    participant Registry as RpcRegistry

    CLI->>Hub: rpc-register { method: "approve_request" }
    Hub->>Registry: register(socket, method)
    Note over Registry: methodToSocketId["approve_request"] = socket.id
    Note over Registry: socketIdToMethods[socket.id].add("approve_request")

    CLI->>Hub: rpc-unregister { method: "approve_request" }
    Hub->>Registry: unregister(socket, method)
    Note over Registry: 移除双向索引
```

## RPC 调用流程

当 Web 端需要调用 CLI 的 RPC 方法时：

```mermaid
sequenceDiagram
    participant Web
    participant SyncEngine
    participant Registry as RpcRegistry
    participant CLI

    Web->>SyncEngine: HTTP API 请求
    SyncEngine->>Registry: getSocketIdForMethod(method)
    Registry-->>SyncEngine: socketId
    SyncEngine->>CLI: rpc-request { method, params }
    CLI-->>SyncEngine: callback(response)
    SyncEngine-->>Web: HTTP 响应
```

## 断线清理

CLI 断开连接时，`unregisterAll` 批量清理：

```typescript
// 在 CLI handlers 的 disconnect 事件中
socket.on('disconnect', () => {
    rpcRegistry.unregisterAll(socket)
})
```

这确保了断线的 CLI 不会残留无效的 RPC 方法注册。
