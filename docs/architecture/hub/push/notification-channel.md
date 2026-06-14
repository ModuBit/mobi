# PushNotificationChannel 架构

**文件**: [`packages/hub/src/push/pushNotificationChannel.ts`](/packages/hub/src/push/pushNotificationChannel.ts)

推送通知通道，实现 `NotificationChannel` 接口，结合 SSE 和 Web Push 实现智能降级通知。

## 依赖关系

```mermaid
flowchart LR
    PNC[PushNotificationChannel]
    PNC --> PS[PushService<br/>Web Push]
    PNC --> SSE[SSEManager<br/>实时推送]
```

> 注：`PushNotificationChannel` 不再依赖 `VisibilityTracker`（构造参数已移除）。通道选择通过 `sseManager.hasActiveConnection(namespace)` 判定有无活跃连接。

## 核心职责

实现 `NotificationChannel` 接口，处理两种通知场景：

| 方法 | 触发场景 |
|------|---------|
| `sendPermissionRequest()` | CLI 请求权限时 |
| `sendReady()` | Agent 等待用户输入时 |

## 降级策略

```mermaid
flowchart TB
    send[发送通知]
    active{会话活跃?}
    connected{有活跃<br/>SSE 连接?}
    sse[sendToast<br/>发所有活跃连接]
    push[Web Push]
    done[完成]

    send --> active
    active -->|否| done
    active -->|是| connected
    connected -->|是| sse
    connected -->|否| push
    sse --> done
    push --> done
```

**通道选择**（Hub 端）：基于 `sseManager.hasActiveConnection(namespace)` 判定，**不再依赖** `VisibilityTracker`。

| 条件 | 通知方式 |
|------|---------|
| 有活跃 SSE 连接（visible 或 hidden） | `sendToast` 发给该 namespace 所有活跃连接（含后台） |
| 无活跃 SSE 连接 | Web Push |

**「要不要打扰」由前端本地判定**：`decideToastAction(sessionId, { activeSessionId, isHidden })` 三分支：

| 连接状态 + 当前路由 | 处理方式 |
|------|---------|
| visible 且当前路由在该 session | 忽略（用户已看到） |
| visible 但不在该 session | 页面 Toast + 角标 |
| hidden | 系统通知（Web Notification） |

多设备天然支持：每个活跃 SSE 连接独立在前端判定展示方式。

## 通知类型

### Permission Request

触发时机：CLI 需要用户授权工具调用时。

```mermaid
block-beta
    columns 1
    block:notif1:1
        columns 1
        title1["Permission Request"]
        sep1["─────────────────"]
        body1["{会话名} ({工具名})"]
    end
```

| 属性 | 值 |
|------|-----|
| title | `Permission Request` |
| body | `{会话名} ({工具名})` |
| tag | `permission-{sessionId}` |
| type | `permission-request` |

### Ready for Input

触发时机：Agent 完成任务，等待用户输入时。

```mermaid
block-beta
    columns 1
    block:notif2:1
        columns 1
        title2["Ready for input"]
        sep2["───────────────"]
        body2["{Agent名} is waiting in {会话名}"]
    end
```

| 属性 | 值 |
|------|-----|
| title | `Ready for input` |
| body | `{Agent名} is waiting in {会话名}` |
| tag | `ready-{sessionId}` |
| type | `ready` |

## 数据结构

### SSE Toast 格式

```typescript
{
    type: 'toast',
    data: {
        title: string,      // 通知标题
        body: string,       // 通知正文
        sessionId: string,  // 会话 ID
        url: string,        // 跳转路径
        kind: 'ready' | 'permission'  // 通知类型（ready=等待输入, permission=权限请求）
    }
}
```

### Web Push Payload 格式

```typescript
{
    title: string,
    body: string,
    tag?: string,           // 用于合并/替换通知
    data?: {
        type: string,       // 通知类型
        sessionId: string,  // 会话 ID
        url: string         // 跳转路径
    }
}
```

## 与其他模块交互

| 模块 | 交互方式 |
|------|---------|
| PushService | 调用 `sendToNamespace()` 发送 Web Push |
| SSEManager | 调用 `hasActiveConnection()` 判定通道、`sendToast()` 发送实时 Toast |
| SyncEngine | 作为 NotificationChannel 被调用 |
