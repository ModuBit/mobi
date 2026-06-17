# 通知系统架构

**文件**:
- [`packages/hub/src/notifications/notificationHub.ts`](/packages/hub/src/notifications/notificationHub.ts)
- [`packages/hub/src/notifications/notificationTypes.ts`](/packages/hub/src/notifications/notificationTypes.ts)
- [`packages/hub/src/notifications/eventParsing.ts`](/packages/hub/src/notifications/eventParsing.ts)
- [`packages/hub/src/notifications/sessionInfo.ts`](/packages/hub/src/notifications/sessionInfo.ts)

通知系统监听 SyncEngine 事件，在适当时机通过多种渠道向用户发送通知。

## 整体架构

```mermaid
flowchart TB
    SE[SyncEngine] -->|订阅事件| NH[NotificationHub]
    NH -->|遍历 channel| PNC[PushNotificationChannel]
    PNC --> Decide{"hasVisible()?<br/>|| !hasSubscription()?"}
    Decide -->|"是：前台 / 无订阅"| SSE[SSEManager<br/>sendToast<br/>投所有活跃连接]
    Decide -->|"否：后台 + 有订阅"| PS[PushService<br/>sendToNamespace<br/>Web Push]
    SSE -->|前端本地判定| Branch[visible+当前 session→忽略<br/>visible+其他 session→页面 Toast+角标<br/>hidden→系统通知]

    subgraph notifications
        NH
        Types[notificationTypes.ts<br/>NotificationChannel 接口]
        EP[eventParsing.ts<br/>事件解析]
        SI[sessionInfo.ts<br/>会话信息]
    end

    PNC -.->|使用| SI
    PNC -.->|使用| EP
    NH -.->|实现| Types
    PNC -.->|实现| Types
```

## 模块职责

### NotificationHub（调度层）

订阅 SyncEngine 事件，检测通知触发时机，分发给所有 channel。

| 文件 | 职责 |
|------|------|
| `notificationHub.ts` | 事件监听、防抖/冷却、分发通知 |
| `notificationTypes.ts` | 定义 `NotificationChannel` 接口和配置 |
| `eventParsing.ts` | 从消息中提取事件类型（检测 ready 事件） |
| `sessionInfo.ts` | 提取会话名称、Agent 名称等显示信息 |

### PushNotificationChannel（执行层）

实现 `NotificationChannel` 接口，负责具体的通知发送策略。

**文件**: [`packages/hub/src/push/pushNotificationChannel.ts`](/packages/hub/src/push/pushNotificationChannel.ts)

详细文档: [推送服务](../push/README.md) | [通知通道](../push/notification-channel.md)

## 通知触发流程

### 权限请求通知

```mermaid
flowchart TB
    event["session-updated / session-added"]
    check1{session 活跃?}
    parse["解析 agentState.requests"]
    diff{"有新请求?"}
    debounce["防抖 500ms"]
    send["notifyPermission()"]

    event --> check1
    check1 -->|否| clear[清理状态]
    check1 -->|是| parse
    parse --> diff
    diff -->|否| skip[跳过]
    diff -->|是| debounce
    debounce --> send
```

**触发条件**: `session.agentState.requests` 中出现新的 requestId。

### Ready 通知

```mermaid
flowchart TB
    event["message-received"]
    parse["extractMessageEventType()"]
    check1{"type === 'ready'?"}
    check2{session 活跃?}
    cooldown{"冷却中?<br/>(5s)"}
    send["notifyReady()"]

    event --> parse
    parse --> check1
    check1 -->|否| skip[跳过]
    check1 -->|是| check2
    check2 -->|否| skip2[跳过]
    check2 -->|是| cooldown
    cooldown -->|是| skip3[跳过]
    cooldown -->|否| send
```

**触发条件**: 收到 `message-received` 事件且消息类型为 `ready`。

## 降级策略

详见 [通知通道文档](../push/notification-channel.md)

```
shouldUseToast = hasVisibleConnection(ns) || !hasSubscription(ns)
  是（前台 / 无 push 订阅）→ sendToast（投该 namespace 所有活跃连接，含后台 hidden）
  否（后台 + 有订阅）→ Web Push
```

**通道选择由 Hub 判定**（`PushNotificationChannel` 按 `shouldUseToast` 分级）：
- **有可见连接**（用户在前台）→ `sendToast` 投递，不打扰。
- **无 push 订阅**（无法走 Web Push）→ `sendToast` 兜底投递，前端转系统通知。
- **后台 + 已订阅 push** → `PushService.sendToNamespace` 发送 Web Push（SW 独立线程，长时后台可靠）。

**「要不要打扰」由前端本地判定**：收到 toast 后，前端 `decideToastAction(sessionId, { activeSessionId, isHidden })` 三分支：

| 连接状态 + 当前路由 | 处理方式 |
|------|---------|
| visible 且当前路由在该 session | 忽略（用户已看到） |
| visible 但不在该 session | 页面 Toast + 角标 |
| hidden | 系统通知（Web Notification） |

多设备天然支持：每个活跃 SSE 连接独立在前端判定展示方式，Hub 不需关心各连接的可见性。

## 组装过程

在 `packages/hub/src/index.ts` 中组装：

```
PushService ←── vapidKeys + store
VisibilityTracker ←── new()
SSEManager ←── heartbeat + VisibilityTracker
PushNotificationChannel ←── PushService + SSEManager
NotificationHub ←── SyncEngine + [PushNotificationChannel]
```

> 注：`PushNotificationChannel` 通过 `sseManager.hasVisibleConnection()` 间接消费 `VisibilityTracker`（构造未直接注入 VT），通道选择公式 `shouldUseToast = hasVisibleConnection(ns) || !hasSubscription(ns)`。VisibilityTracker、`/api/visibility` 上报、前端 visibilitychange 均为通知投递的核心依赖。

## NotificationChannel 接口

```typescript
interface NotificationChannel {
    sendReady(session: Session): Promise<void>
    sendPermissionRequest(session: Session): Promise<void>
}
```

目前只有一个实现 `PushNotificationChannel`，接口设计支持扩展其他渠道（邮件、Slack 等）。

## 配置项

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `readyCooldownMs` | 5000 | Ready 通知冷却时间，避免频繁通知 |
| `permissionDebounceMs` | 500 | 权限请求防抖时间，合并短时间内的多次请求 |
