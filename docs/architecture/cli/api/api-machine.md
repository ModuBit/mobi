# ApiMachineClient (`apiMachine.ts`)

Machine 级别的 Socket.IO 客户端，负责 Runner 与 Hub 之间的机器管理通信。

## 核心职责

- 建立 machine-scoped WebSocket 连接
- Machine 元数据同步（带乐观锁）
- Runner 状态同步（带乐观锁）
- Machine 级 RPC 注册与处理（spawnSession、stopSession 等）
- 心跳保活

## 连接参数

```typescript
io(`${apiUrl}/cli`, {
    auth: {
        token,                          // Bearer token
        clientType: 'machine-scoped',   // 连接身份标识
        machineId                       // Machine ID
    },
    transports: ['websocket'],
    reconnection: true,
    reconnectionDelayMax: 5000
})
```

## Socket.IO 事件

### 上行事件（Runner → Hub）

| 事件 | 数据 | 说明 |
|------|------|------|
| `machine-alive` | `{ machineId, time }` | 心跳（20s 间隔） |
| `machine-update-metadata` | `{ machineId, metadata, expectedVersion }` | 元数据更新（带 ACK） |
| `machine-update-state` | `{ machineId, runnerState, expectedVersion }` | 状态更新（带 ACK） |
| `rpc-register` | `{ method }` | 注册 RPC 方法 |
| `rpc-unregister` | `{ method }` | 注销 RPC 方法 |

### 下行事件（Hub → Runner）

| 事件 | 数据 | 说明 |
|------|------|------|
| `update` | `UpdateMachineBody` | 服务端推送元数据/状态变更 |
| `rpc-request` | `{ method, params }` | RPC 调用请求 |
| `error` | `{ message }` | 错误通知 |

## 版本化状态更新

### updateMachineMetadata(handler)

```typescript
await backoff(async () => {
    const updated = handler(currentMetadata)
    const answer = await socket.emitWithAck('machine-update-metadata', {
        machineId, metadata: updated, expectedVersion
    })
    applyVersionedAck(answer, { ... })
})
```

### updateRunnerState(handler)

同样的模式，用于更新 Runner 运行状态（pid, httpPort, status 等）。

两个操作都通过 `backoff` 包装，失败时自动重试。

## RPC 注册

### 构造时注册

1. **Common Handlers**: 通过 `registerCommonHandlers` 注册通用 RPC（文件、bash、git 等）
2. **path-exists**: 检查给定路径是否存在且为目录

### setRPCHandlers 设置

Runner 启动完成后调用 `setRPCHandlers`，注入核心 RPC 方法：

| 方法 | 参数 | 返回值 | 说明 |
|------|------|--------|------|
| `spawn-mobi-session` | `{ directory, sessionId, agent, model, ... }` | `{ type, sessionId? }` | 创建新的 Claude 会话 |
| `stop-session` | `{ sessionId }` | `{ message }` | 停止指定会话 |
| `stop-runner` | - | `{ message }` | 停止整个 Runner（延迟 100ms） |

### spawn-mobi-session 结果类型

```typescript
{ type: 'success', sessionId }
{ type: 'requestToApproveDirectoryCreation', directory }
{ type: 'error', errorMessage }
```

## 服务端推送处理

`update` 事件处理 `update-machine` 类型的推送：

```
socket.on('machine-update', data)
    │
    ├── 过滤: body.t !== 'update-machine' → 忽略
    ├── 过滤: machineId !== this.machine.id → 忽略
    │
    ├── metadata 变更 → MachineMetadataSchema 解析 → 更新本地缓存
    └── runnerState 变更 → RunnerStateSchema 解析 → 更新本地缓存
```

这是 Hub 侧主动推送的变更（如 Web 端修改了 Machine 信息），通过 Zod 校验保护。

## 心跳保活

```typescript
// 每 20 秒发送一次心跳
setInterval(() => {
    socket.emit('machine-alive', { machineId, time: Date.now() })
}, 20_000)
```

- 连接建立时启动
- 断线时停止
- 使用普通 emit（非 volatile），确保 Hub 收到

## 生命周期

```
constructor → 注册 common RPC handlers + path-exists
    │
setRPCHandlers → 注册 spawn/stop session RPC
    │
connect → onSocketConnect
    │
    ├── 注册所有 RPC 方法到新 socket
    ├── 更新 runnerState 为 running
    └── 启动心跳
    │
    ├── RPC 请求处理
    ├── 状态同步
    └── 服务端推送处理
    │
disconnect → 清理 RPC socket 引用 + 停止心跳
    │
shutdown → close socket
```

## 与 ApiSessionClient 的对比

| 特性 | ApiMachineClient | ApiSessionClient |
|------|-----------------|-----------------|
| 作用域 | Machine（Runner 级） | Session（Claude 会话级） |
| 连接身份 | `machine-scoped` | `session-scoped` |
| 消息同步 | 无 | 双向消息转发 |
| 元数据更新 | machine metadata | session metadata |
| 状态更新 | runnerState | agentState |
| Terminal | 无 | 有 |
| 消息回填 | 无 | 有 |
| RPC | spawnSession, stopSession, path-exists | 通用 handlers |
| 心跳 | 20s `machine-alive` | `session-alive` |
| 持有者 | Runner | Claude Session (loop) |
