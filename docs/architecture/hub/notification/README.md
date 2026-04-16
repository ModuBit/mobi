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
    PNC --> VT{页面可见?}
    VT -->|是| SSE[SSEManager<br/>sendToast]
    VT -->|否| PS[PushService<br/>sendToNamespace]
    SSE -->|未送达| PS

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
页面可见 → SSE Toast 优先 → 未送达则 Web Push
页面不可见 → 直接 Web Push
```

## 组装过程

在 `packages/hub/src/index.ts` 中组装：

```
PushService ←── vapidKeys + store
VisibilityTracker ←── new()
SSEManager ←── heartbeat + VisibilityTracker
PushNotificationChannel ←── PushService + SSEManager + VisibilityTracker
NotificationHub ←── SyncEngine + [PushNotificationChannel]
```

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
