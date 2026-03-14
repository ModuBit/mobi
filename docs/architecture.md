# Mobi 架构文档

## 概述

Mobi 是一个 Claude Code 远程控制工具，允许用户通过浏览器（特别是手机）远程与本地 Claude Code 会话交互。

## 架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                         Web Frontend                             │
│                    (React + Ant Design + xterm)                 │
└─────────────────────────────────────────────────────────────────┘
                                │
                                │ HTTP/SSE + Socket.IO
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                          Mobi Hub                               │
│                    (Bun + Hono + SQLite)                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │  SyncEngine  │  │    Store     │  │   Web Server │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
└─────────────────────────────────────────────────────────────────┘
                                │
                                │ Socket.IO
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                          Mobi CLI                               │
│                    (Bun + Node.js 子进程)                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ Local Loop   │  │ Remote Loop  │  │  API Client  │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
└─────────────────────────────────────────────────────────────────┘
                                │
                                │ 子进程
                                ▼
                        ┌───────────────┐
                        │  Claude Code  │
                        └───────────────┘
```

## Monorepo 结构

```
mobi/
├── shared/          # 共享协议层
│   └── src/
│       ├── schemas.ts    # Zod schema 定义
│       ├── types.ts      # TypeScript 类型
│       └── modes.ts      # 权限/模型模式
│
├── hub/             # 服务器
│   └── src/
│       ├── sync/         # 同步引擎
│       ├── store/        # SQLite 存储层
│       ├── socket/       # Socket.IO 处理
│       ├── sse/          # SSE 管理器
│       └── web/          # HTTP API 路由
│
├── cli/             # 客户端
│   └── src/
│       ├── claude/       # Claude Code 交互
│       ├── agent/        # Local/Remote 循环
│       ├── api/          # API 客户端
│       └── commands/     # CLI 子命令
│
└── web/             # 前端
    └── src/
        ├── components/   # React 组件
        ├── stores/       # Zustand 状态
        ├── i18n/         # 国际化
        └── main.tsx      # 入口
```

## 核心组件

### 1. Shared (`@mobi/shared`)

共享协议层，定义数据结构和类型：

- **schemas.ts**: Session, AgentState, SyncEvent 等 Zod schema
- **types.ts**: 导出 TypeScript 类型
- **modes.ts**: PermissionMode, ModelMode 枚举

### 2. Hub

服务器组件：

| 模块 | 文件 | 职责 |
|------|------|------|
| 同步引擎 | `hub/src/sync/syncEngine.ts` | 会话同步、事件分发 |
| 存储层 | `hub/src/store/index.ts` | SQLite 数据持久化 |
| Socket | `hub/src/socket/` | Socket.IO 连接处理 |
| SSE | `hub/src/sse/` | Server-Sent Events |
| Web | `hub/src/web/` | REST API 路由 |

### 3. CLI

客户端组件：

| 模块 | 文件 | 职责 |
|------|------|------|
| 会话循环 | `cli/src/claude/loop.ts` | Local/Remote 模式切换 |
| 启动器 | `cli/src/claude/claudeLocalLauncher.ts` | 本地模式启动 |
| 启动器 | `cli/src/claude/claudeRemoteLauncher.ts` | 远程模式启动 |
| 基础循环 | `cli/src/agent/loopBase.ts` | `runLocalRemoteSession` 函数 |

### 4. Web

前端组件：

| 模块 | 职责 |
|------|------|
| `components/chat/` | 聊天界面 |
| `components/session/` | 会话管理 |
| `stores/uiStore.ts` | UI 状态（主题等） |
| `i18n/` | 国际化（中/英文） |

## 通信机制

### 1. CLI ↔ Hub

- **Socket.IO**: 实时双向通信
- **事件类型**:
  - `session-added`: 新会话
  - `session-updated`: 会话更新
  - `message-received`: 新消息
  - `heartbeat`: 心跳

### 2. Web ↔ Hub

- **HTTP API**: REST 接口
- **SSE**: 服务器推送事件
- **Socket.IO**: 实时通信

## 数据模型

### Session

```typescript
interface Session {
  id: string
  namespace: string
  seq: number
  createdAt: number
  updatedAt: number
  active: boolean
  metadata: Metadata | null
  agentState: AgentState | null
  thinking: boolean
  todos?: TodoItem[]
  permissionMode?: PermissionMode
  modelMode?: ModelMode
}
```

### AgentState

```typescript
interface AgentState {
  controlledByUser?: boolean
  requests?: Record<string, AgentStateRequest>
  completedRequests?: Record<string, AgentStateCompletedRequest>
}
```

## 配置

- **数据目录**: `~/.mobi/`
- **数据库**: SQLite (WAL 模式)
- **默认端口**: 2222

## 扩展性

保留多 Agent 扩展接口：
- `teamState`: 团队状态
- `TeamMember`, `TeamTask`, `TeamMessage`: 团队相关类型
