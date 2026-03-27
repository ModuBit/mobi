# Hub 模块

Hub 是 Mobi 的核心服务器，连接 CLI 客户端和 Web 前端。

## 整体架构

```mermaid
graph TB
    CLI[CLI 客户端]
    Web[Web 浏览器]

    subgraph Hub
        IO[SocketServer<br/>Socket.IO]
        WS[WebServer<br/>HTTP + SSE]
        SE[SyncEngine]
        Store[(Store)]
    end

    CLI <-->|实时| IO
    CLI -->|初始化| WS
    Web <-->|实时| IO
    Web <-->|HTTP/SSE| WS

    IO <--> SE
    WS --> SE
    SE --> Store
```

## 数据通道

### 上行流（CLI → Hub → Web）

| 路径 | 场景 |
|------|------|
| **HTTP** | 会话/机器初始化、消息回填 |
| **Socket.IO** | 心跳、消息、状态更新、终端事件 |

### 下行流（Web → Hub → CLI）

| 路径 | 场景 |
|------|------|
| **MessageService** | 发送消息 |
| **RpcGateway** | 权限操作、会话控制、文件操作、Git 操作 |

### 终端通道

CLI ↔ Socket.IO(/terminal) ↔ Web，实时双向，不经过 SyncEngine。

详见 [SyncEngine 架构](./sync-engine)。

## 核心组件

| 组件 | 职责 |
|------|------|
| **[SyncEngine](./sync-engine)** | 同步引擎，协调所有数据操作 |
| **SocketServer** | Socket.IO 服务器，处理 CLI 连接 |
| **[WebServer](./web-server)** | HTTP 服务器，提供 API 和静态资源 |
| **[SSEManager](./sse-manager)** | 管理 SSE 连接，向 Web 推送实时事件 |
| **[Store](./store)** | 数据存储，SQLite 数据库 |

## 启动流程

```mermaid
flowchart LR
    A[加载配置] --> B[创建 Store]
    B --> C[创建 SocketServer]
    C --> D[创建 SyncEngine]
    D --> E[启动 WebServer]
    E --> F[就绪]
```

## 代码入口

```
hub/src/
├── index.ts           # 主入口
├── sync/
│   └── syncEngine.ts  # 同步引擎
├── socket/
│   └── server.ts      # Socket.IO 服务器
├── web/
│   └── server.ts      # HTTP 服务器
├── sse/
│   └── sseManager.ts  # SSE 管理器
└── store/
    └── index.ts       # 数据存储
```
