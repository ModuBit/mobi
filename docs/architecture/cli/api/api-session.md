# ApiSessionClient (`apiSession.ts`)

Session 级别的 Socket.IO 客户端，负责 Claude 会话与 Hub 之间的双向消息同步。

## 核心职责

- 建立 session-scoped WebSocket 连接
- 双向消息转发（Claude 输出 → Hub，Hub 用户消息 → Claude）
- 消息回填（断线重连后补漏）
- Session 元数据/状态同步（带乐观锁）
- Terminal 会话管理
- Session-scoped RPC 处理

## 连接参数

```typescript
io(`${apiUrl}/cli`, {
    auth: {
        token,                          // Bearer token
        clientType: 'session-scoped',   // 连接身份标识
        sessionId                       // Session ID
    },
    transports: ['websocket'],
    reconnection: true,
    reconnectionAttempts: Infinity      // 永不放弃重连
})
```

## 消息流向

### Claude → Hub（上行）

```
Claude 进程输出 → loop.ts → ApiSessionClient.sendClaudeSessionMessage(body)
                                         │
                                         ├── type=user, 非sidechain → { role:'user', content:{text} }
                                         └── 其他 → { role:'agent', content:{output, data} }
                                         │
                                         ▼
                                   socket.emit('message')
```

- **用户消息**: `type === 'user'` 且非 sidechain/meta → 作为 `user` 角色发送
- **Agent 输出**: 所有其他消息作为 `agent` 角色发送
- **Summary 更新**: 检测 `type === 'summary'`，自动更新 session metadata

### Hub → Claude（下行）

```
socket.on('update', { body.t === 'new-message' })
                    │
                    ▼
            handleIncomingMessage()
                    │
                    ├── seq 去重检查（单调递增）
                    ├── UserMessageSchema 解析
                    ├── localId 合并（Hub 放在 message 外层，合并进 UserMessage）
                    ├── enqueueUserMessage()
                    └── 其他 → emit('message')
                    │
                    ▼
            pendingMessageCallback → loop.ts 处理
```

- **消息去重**: 基于 `seq` 单调递增，跳过旧消息
- **localId 合并**: Hub 将 `localId` 放在 message 外层（与 content 信封同级），`handleIncomingMessage` 将其合并进 UserMessage，供 `runClaude` 入队 → `collectBatch` → `emitMessagesConsumed` 追踪 consume
- **消息缓冲**: `pendingMessages` 队列，在 callback 注册前暂存消息

### 消息类型

| 类型 | 结构 | 方向 |
|------|------|------|
| 用户文本 | `{ role:'user', content:{type:'text', text} }` | Hub→Claude |
| Agent 输出 | `{ role:'agent', content:{type:'output', data} }` | Claude→Hub |
| Agent 事件 | `{ role:'agent', content:{type:'agent', data} }` | Claude→Hub |
| Session 事件 | `{ role:'agent', content:{type:'event', data} }` | Claude→Hub |

## 消息回填机制

断线重连后，通过 HTTP API 补漏丢失的消息：

```
reconnect → needsBackfill = true → backfillIfNeeded()
                                          │
                                          ▼
                            GET /cli/sessions/:id/messages?afterSeq=X&limit=200
                                          │
                                          ▼
                            逐页处理直到无新消息
```

- **触发条件**: `hasConnectedOnce` 后的每次重连
- **游标**: 基于 `lastSeenMessageSeq` 单调递增
- **分页**: 每页最多 200 条
- **去重**: `handleIncomingMessage` 的 seq 检查确保不重复
- **并发控制**: `backfillInFlight` 确保同时只有一个回填请求

## 版本化状态更新

### updateMetadata(handler)

```
当前 metadata → handler(新值) → emitWithAck('update-metadata', {sid, expectedVersion, metadata})
                                         │
                                         ├── success → 应用新版本
                                         ├── version-mismatch → 获取最新值，backoff 重试
                                         └── error → 抛异常，backoff 重试
```

### updateAgentState(handler)

同样的乐观锁模式，用于更新 agent 状态。

两个更新操作各自有 `AsyncLock` 保证串行执行。

## Terminal 管理

通过 `TerminalManager` 管理 Hub 侧发起的终端会话：

| 事件 | 方向 | 说明 |
|------|------|------|
| `terminal:open` | Hub→CLI | 创建终端实例 |
| `terminal:write` | Hub→CLI | 写入数据 |
| `terminal:resize` | Hub→CLI | 调整大小 |
| `terminal:close` | Hub→CLI | 关闭终端 |
| `terminal:ready` | CLI→Hub | 终端就绪 |
| `terminal:output` | CLI→Hub | 输出数据 |
| `terminal:exit` | CLI→Hub | 终端退出 |
| `terminal:error` | CLI→Hub | 错误 |

所有 Terminal 事件通过 Zod Schema 校验 + `sessionId` 过滤。

## RPC 支持

Session 级 RPC 通过 `RpcHandlerManager` 管理：
- 构造时注册 `commonHandlers`（文件操作、bash、git 等）
- 通过 `rpc-request` 事件接收 Hub 侧的 RPC 调用
- 方法名格式: `{sessionId}:{method}`

## Session 事件

`sendSessionEvent` 发送特殊事件到 Hub：

| 事件类型 | 数据 | 用途 |
|----------|------|------|
| `switch` | `{ mode: 'local'|'remote' }` | 通知模式切换 |
| `message` | `{ message: string }` | 系统消息 |
| `permission-mode-changed` | `{ mode }` | 权限模式变更 |
| `ready` | - | Session 就绪 |

### 排队消息消费通知

`emitMessagesConsumed(localIds)` 通过 `socket.emit('messages-consumed', { sid, localIds })` 通知 Hub：这批 localId 的消息已被 agent 真正消费。由 `runClaude` 绑定到 `MessageQueue.setOnBatchConsumed` 回调，批次消费后自动触发。Hub 收到后将 `invokedAt` 落库并转发 SSE 给 Web。

### 上下文用量上报

`reportContextUsage(usage)` 通过 `socket.emit('context-usage', { sid, contextUsage })` 上报上下文用量。由 `claudeRemoteLauncher` 事件驱动触发（`system/init` · `assistant` · `result` · `/compact` 完成 · `/clear`），经 `ContextUsageCollector` 调 SDK `getContextUsage()` 裁剪后上报。Hub 落库到 `runtimeState.contextUsage`（复用 `updateRuntimeStateField`）+ SSE 推 Web。非定时轮询（定时器兜底见 `docs/pending.md` #36）。

## IdleTimer 集成

ApiSessionClient 集成 `IdleTimer` 实现 Session 自动超时关闭：

### 超时类型

| 类型 | 触发条件 | 默认超时 |
|------|---------|---------|
| 连接断开超时 | Socket.IO 断开且重连失败 | 10 分钟 |
| 交互不活跃超时 | 无任何信息流活动 | 1 天 |

### 核心方法

| 方法 | 说明 |
|------|------|
| `startIdleTimer()` | 启动计时器（Remote 模式） |
| `stopIdleTimer()` | 停止计时器（Local 模式） |
| `resetIdleTimer()` | 重置计时器（有活动时） |

### 事件发射

| 事件 | 触发时机 |
|------|---------|
| `disconnect-timeout` | 连接断开超时 |
| `idle-timeout` | 交互不活跃超时 |

### 活动重置触发点

- 用户发送消息（`nextMessage` 回调）
- Agent 输出（`onMessage` 回调）
- 权限审批响应
- 终端输入
- RPC 调用（通过 `setOnRpcCalled` 回调）
- 状态更新（`updateMetadata` / `updateAgentState`）

### 预警通知

交互不活跃超时提前 5 分钟发送预警：

```
socket.emit('idle-timeout-warning', { sid, timeoutAt, remainingMs })
```

## 生命周期

```
constructor → autoConnect=false
    │
    ▼ (外部调用 socket.connect() 或等待自动重连)
connect → onSocketConnect → backfillIfNeeded → session-alive
    │
    ├── 消息循环 (send/receive)
    ├── 状态同步 (metadata/agentState)
    ├── RPC 处理
    └── Terminal 管理
    │
disconnect → closeAll terminals → mark needsBackfill
    │
    ▼ (reconnect)
connect → backfillIfNeeded → ...
    │
close → disconnect socket, cleanup
```

### flush() 优雅关闭

```
flush({ timeoutMs })
    ├── drain metadataLock
    ├── drain agentStateLock
    ├── waitForConnected
    └── socket.timeout().emitWithAck('ping')  // 确认消息到达
```

用于 session 结束时确保所有待发消息到达 Hub。

## 关键设计

1. **队列解耦**: `pendingMessages` 队列解耦消息到达与消费者注册的时序
2. **seq 去重**: 基于单调递增 seq 的消息去重
3. **AsyncLock**: metadata 和 agentState 更新各自串行化
4. **backoff 重试**: 版本冲突时自动重试
5. **volatile keepAlive**: `session-alive` 使用 volatile emit（不保证送达，避免堆积）
