# SSEManager

**文件**: [`packages/hub/src/sse/sseManager.ts`](/packages/hub/src/sse/sseManager.ts)

管理 SSE（Server-Sent Events）连接，负责事件推送。

## 架构

```mermaid
flowchart TB
    subgraph SSEManager
        connections[connections Map]
        heartbeat[心跳定时器 30s]
    end

    web[Web 客户端] -->|subscribe| SSEManager
    SSEManager -->|broadcast/sendToast| web
    heartbeat -->|sendHeartbeat| web
```

## 核心方法

| 方法 | 作用 |
|------|------|
| `subscribe()` | 注册 SSE 连接 |
| `unsubscribe()` | 移除 SSE 连接 |
| `broadcast()` | 广播事件给所有匹配的连接 |
| `sendToast()` | 发送 toast 事件给该 namespace 所有活跃连接（含后台 hidden） |
| `hasActiveConnection()` | 查询某 namespace 是否有任何活跃连接（visible 或 hidden） |
| `hasVisibleConnection()` | 查询某 namespace 是否有可见连接（通知投递决策依据，转发 VisibilityTracker） |
| `stop()` | 停止所有连接和心跳 |

## sendToast vs broadcast

| | sendToast | broadcast |
|--|-----------|-----------|
| **投递范围** | 该 namespace 所有活跃连接（含后台 hidden） | 所有匹配连接 |
| **namespace** | 指定 namespace | 从 event 中提取 |
| **返回值** | 返回成功送达数量 | 无返回值 |
| **用途** | Toast 通知 | 广播事件 |

### sendToast

```typescript
async sendToast(namespace: string, event): Promise<number>
```

**发送条件**：
1. namespace 匹配
2. 匹配该 namespace 的**所有活跃连接**（含后台 hidden）

**使用场景**：`PushNotificationChannel` 调用 `sendToast`（投递决策见 [push 架构](../push/README.md)），前端据 `hidden` 标志决定页面 Toast 或系统通知。

```mermaid
flowchart TB
    need[需要通知]
    decide{"hasVisible()?<br/>|| !hasSubscription()?"}
    toast[sendToast<br/>投所有活跃连接]
    push[Web Push]
    done[完成]

    need --> decide
    decide -->|"是（前台 / 无订阅）"| toast
    decide -->|"否（后台 + 有订阅）"| push
    toast --> done
    push --> done
```

### broadcast

```typescript
broadcast(event: SyncEvent): void
```

**发送条件**（`shouldSend` 逻辑）：

| 事件类型 | 发送对象 |
|---------|---------|
| `connection-changed` | 所有连接 |
| `message-received` | all=true 或对应 session 的订阅者 |
| `message-snapshot` | all=true 或对应 session 的订阅者 |
| `messages-consumed` | all=true 或对应 session 的订阅者 |
| `idle-timeout-warning` | all=true 或对应 session 的订阅者 |
| `session-updated` | all=true 或 session 匹配 |
| `machine-updated` | all=true 或 machine 匹配 |

**使用场景**：SyncEngine 广播事件给所有订阅者

## 订阅过滤逻辑

`shouldSend()` 方法决定事件是否发送给某个连接：

```mermaid
flowchart TB
    event[事件] --> check{过滤判断}

    check -->|connection-changed| always[始终发送]
    check -->|message-received| session{匹配 sessionId}
    check -->|message-snapshot| session
    check -->|idle-timeout-warning| session
    check -->|all=true| all[发送所有事件]
    check -->|event.sessionId| match[匹配 sessionId]
    check -->|event.machineId| match[匹配 machineId]
    check -->|其他| skip[不发送]
```

## 心跳机制

```mermaid
flowchart TB
    subscribe[新连接] --> ensure[启动心跳]
    ensure --> timer[30s 定时器]
    timer --> loop[遍历连接]
    loop --> send[发送心跳]
    send --> success[成功]
    send --> fail[失败]
    fail --> unsubscribe[移除连接]

    unsubscribe[无连接] --> stop[停止心跳]
```

## 与 VisibilityTracker 的关系

SSEManager 构造时注入 `VisibilityTracker`，暴露 `hasVisibleConnection(namespace)`（转发 `visibilityTracker.hasVisibleConnection`）作为通知投递决策依据。`PushNotificationChannel` 据此分级：`shouldUseToast = hasVisibleConnection(ns) || !hasSubscription(ns)`（有可见连接 → SSE toast 不打扰 / 无 push 订阅 → SSE toast 兜底 / 后台 + 有订阅 → Web Push）。

`sendToast()` 本身投递该 namespace **所有活跃连接**（含后台 hidden），不按可见性过滤——「要不要打扰」由前端本地三分支判定（visible+当前 session→忽略 / visible+其他→页面 Toast+角标 / hidden→系统通知）。
