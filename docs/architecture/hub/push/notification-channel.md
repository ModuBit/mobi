# PushNotificationChannel 架构

**文件**: [`packages/hub/src/push/pushNotificationChannel.ts`](/packages/hub/src/push/pushNotificationChannel.ts)

推送通知通道，实现 `NotificationChannel` 接口，结合 SSE 和 Web Push 实现智能降级通知。

## 依赖关系

```mermaid
flowchart LR
    PNC[PushNotificationChannel]
    PNC --> PS[PushService<br/>Web Push]
    PNC --> SSE[SSEManager<br/>实时推送]
    PNC --> VT[VisibilityTracker<br/>可见性追踪]
```

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
    visible{页面可见?}
    sse[尝试 SSE Toast]
    delivered{SSE 送达?}
    push[Web Push]
    done[完成]

    send --> active
    active -->|否| done
    active -->|是| visible
    visible -->|是| sse
    visible -->|否| push
    sse --> delivered
    delivered -->|是| done
    delivered -->|否| push
    push --> done
```

**优先级**：SSE Toast > Web Push

| 条件 | 通知方式 |
|------|---------|
| 页面可见 + SSE 送达 | SSE Toast（实时） |
| 页面可见 + SSE 未送达 | Web Push |
| 页面不可见 | Web Push |

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
        url: string         // 跳转路径
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
| SSEManager | 调用 `sendToast()` 发送实时 Toast |
| VisibilityTracker | 调用 `hasVisibleConnection()` 检查可见性 |
| SyncEngine | 作为 NotificationChannel 被调用 |
