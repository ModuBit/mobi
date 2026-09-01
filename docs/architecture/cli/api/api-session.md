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
- **入站跨会话消息**: `sendInboundCrossSessionMessage(text, kind, fromName, nativeId)`（2026-08-28；2026-09-01 批次 D 加 kind）——UserPromptSubmit hook 观测的入站 turn（`classifyInboundTurn` 甄别 peer/scheduled/loop）唯一持久化入口，`role=user` + `meta.crossSession={from}` + `meta.turnOrigin=kind`（sentFrom 恒 'cli' 不排队）

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

### 消息事实上报（messages-facts）

CLI→Hub 的消息事实收敛为单一 socket 事件 `messages-facts`（载荷 `{ sid, facts: MessageFact[] }`，shared `MessageFact` 联合类型）。四个 emit 方法 + 新增的 `emitLifecycleFact` / `emitWithdrawnFact` 全部收敛到私有 `emitFacts` 统一出口：

| 方法 | fact kind | 触发 |
|------|-----------|------|
| `emitMessagesSubmitted(localIds)` | `pushed` | `runClaude` 绑定到 `MessageQueue.setOnBatchConsumed` 回调，批次消费后自动触发；Hub 侧 `markMessagesPushed` 推进 `lifecycle='pushed'` 并转发 SSE 给 Web |
| `emitMessagesBound(bindings, nativeSessionId?)` | `bound` | push 给 SDK 时生成预设 uuid（native 锚点），`(localId, nativeId)` 配对即确定即上报 |
| `emitNativeAttached(nativeSessionId)` | `attached` | `onSessionFound` 中 id 真正变化时补写该会话缺 nativeSessionId 的消息行 |
| `emitMessagesAcked(nativeId)` | `acked` | CC isReplay 回显确认（rewind 判据） |
| `emitLifecycleFact(nativeId, state)` | `lifecycle` | `onMessage` 中 `commandLifecycleToFact` 拦截 CC 的 command_lifecycle 帧（started→processing、completed→done、cancelled/discarded/refused 直传，可选 `terminal_reason` 透传），转终态信号上报 |
| `emitWithdrawnFact(nativeId)` | `withdrawn` | 撤回刚发消息（#53，批次 A）：`handleAbortRequest('turn')` 撤回两段式复验通过后上报，Hub 侧软删除 + SSE `message-withdrawn` |

不再直接 emit 旧 4 事件（`messages-submitted` / `messages-bound` / `messages-native-attached` / `messages-acked`）——旧事件由 Hub 保留兼容旧 CLI 二进制双受理（#54 收敛清理时下线）。

### 上下文用量上报

`reportContextUsage(usage)` 通过 `socket.emit('context-usage', { sid, contextUsage })` 上报上下文用量。每轮 `result` 时由 `claudeRemoteLauncher` 本地组装（**不调** SDK `getContextUsage()`——其在子进程内会触发大量 `count_tokens` 请求撑爆 provider 限流）：`maxTokens` = `result.modelUsage[model].contextWindow`，`costUsd` = `result.total_cost_usd`。Hub 落库到 `runtimeState.contextUsage`（复用 `updateRuntimeStateField`）+ SSE 推 Web。

> ⚠️ **`totalTokens` 现状与目标（2026-08-26 实测钉死）**：当前实现 `calcContextUsageFromResult` 用 `result.usage` 的三项和当"当前占用"——**口径错误**：`result.usage` 是 turn 内主循环所有请求的逐项累计（实测 255232 = 127488+127744），会远超窗口（1M 窗口显示 1.12M）且随 turn 内请求数波动。正确口径 = 主线最后一条 assistant 的瞬时水位（见下），修复方案见 `docs/superpowers/specs/2026-08-25-context-waterline-design.md`（含 assistant usage 在装配层丢失、需从 stream_event 捕获注入的根因）。

> usage 账本语义（2026-08-26 修正）：`message_start` 的 `usage` 输入三项（input/cc/cr）是终值（请求发出时输入已 tokenize 完），`output_tokens` 为占位；`message_delta` 的 `usage.output_tokens` 为累计终值，输入三项亦可回填非空累计值（SDK 类型 `BetaMessageDeltaUsage` 三项为 `number|null`，服务端实践常态为 null）；**无 `message_end`**，`message_stop` 不带 usage。两者都是**单次 API 请求**的账（Messages API 无状态，每个 turn 的工具循环 = 多次独立请求，input 随历史逐次变大），**无会话累计字段**。「上下文占用」语义 = 该条消息完成后的瞬时占用（message_start 三项 + message_delta output 四项和）——`result.usage` **不是**它（是累计），此前"`result` 带来的正是它"的结论错误，已推翻。当前 `handleStreamEvent` 处理 `message_start` 只拿 `model`/`message.id`/`sdkUuid`，usage 未捕获——这正是装配消息 usage 全 0 的根因（修复见上述 spec）。

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
