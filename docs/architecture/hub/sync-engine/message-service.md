# MessageService

**文件**: [`hub/src/sync/messageService.ts`](/hub/src/sync/messageService.ts)

消息服务，处理消息的分页查询和发送。

## 架构

```mermaid
flowchart TB
    subgraph MessageService
        getMessagesPage[getMessagesPage]
        getMessagesAfter[getMessagesAfter]
        sendMessage[sendMessage]
    end

    subgraph 依赖
        Store[Store<br/>MessageStore]
        IO[Socket.IO<br/>/cli namespace]
        Publisher[EventPublisher]
    end

    WebAPI[Web API] -->|分页查询| getMessagesPage
    WebAPI -->|增量获取| getMessagesAfter
    WebAPI -->|发送消息| sendMessage

    getMessagesPage --> Store
    getMessagesAfter --> Store
    sendMessage --> Store
    sendMessage --> IO
    sendMessage --> Publisher

    Publisher -->|message-received| SSE[SSEManager]
    SSE -->|推送| Web[Web 客户端]
    IO -->|update| CLI[CLI 客户端]
```

## 核心方法

| 方法 | 作用 |
|------|------|
| `getMessagesPage()` | 分页获取消息（支持向上翻页） |
| `getMessagesAfter()` | 获取指定序号后的消息（增量同步） |
| `sendMessage()` | 发送消息 |

## 消息发送流程

```mermaid
sequenceDiagram
    participant Web as Web 客户端
    participant API as HTTP API
    participant MS as MessageService
    participant Store as MessageStore
    participant IO as Socket.IO
    participant Pub as EventPublisher
    participant CLI as CLI 客户端
    participant SSE as SSEManager

    Web->>API: POST /api/sessions/:id/messages
    API->>MS: sendMessage()
    MS->>Store: addMessage()
    Store-->>MS: msg
    MS->>IO: emit('update', new-message)
    IO-->>CLI: 推送消息
    MS->>Pub: emit('message-received')
    Pub->>SSE: broadcast()
    SSE-->>Web: SSE 推送
```

### sendMessage 详细流程

```mermaid
flowchart TB
    send[sendMessage] --> build[构建消息内容]
    build --> store[Store.addMessage<br/>持久化]
    store --> socket[IO.emit update<br/>通知 CLI]
    socket --> publisher[Publisher.emit<br/>message-received]
    publisher --> sse[SSE 广播<br/>通知 Web]
```

**消息内容格式**：

```typescript
{
    role: 'user',
    content: {
        type: 'text',
        text: string,
        attachments?: AttachmentMetadata[]
    },
    meta: {
        sentFrom: 'webapp' | 'cli'
    }
}
```

## 分页查询

### getMessagesPage

```
GET /api/sessions/:id/messages?limit=50&beforeSeq=100
```

**返回结构**：

```typescript
{
    messages: DecryptedMessage[],
    page: {
        limit: number,
        beforeSeq: number | null,
        nextBeforeSeq: number | null,
        hasMore: boolean
    }
}
```

### getMessagesAfter

```
GET /api/sessions/:id/messages/after?afterSeq=100&limit=50
```

用于增量同步，获取指定序号之后的新消息。

## 事件发布

| 方法入口 | 触发点 | 事件类型 | 说明 |
|----------|--------|----------|------|
| `sendMessage` | 用户发送消息 | `message-received` | 包含完整消息内容 |
