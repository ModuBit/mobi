# WebServer 认证机制

## 概述

WebServer 有两套认证机制：

| 认证方式 | 使用者 | HTTP 路由 | Socket.IO 命名空间 |
|----------|--------|-----------|-------------------|
| **Access Token** | CLI 客户端 | `/cli/*` | `/cli` |
| **JWT** | Web 浏览器 | `/api/*` | `/terminal` |

## 认证流程

```mermaid
sequenceDiagram
    participant CLI as CLI 客户端
    participant Web as Web 浏览器
    participant Server as WebServer

    Note over CLI,Server: CLI 直接使用 Access Token
    CLI->>Server: HTTP /cli/* 或 Socket.IO /cli + Access Token
    Server->>Server: 验证 Access Token
    Server-->>CLI: 响应

    Note over Web,Server: Web 需要先换取 JWT
    Web->>Server: POST /api/auth { accessToken }
    Server->>Server: 验证 Access Token
    Server-->>Web: 返回 JWT
    Web->>Server: HTTP /api/* 或 Socket.IO /terminal + JWT
    Server->>Server: 验证 JWT
    Server-->>Web: 响应
```

## 路由认证要求

| 路由 | 认证 | 说明 |
|------|------|------|
| `/health` | 无 | 健康检查 |
| `/cli/*` | Access Token | CLI 专用 API |
| `POST /api/auth` | 无 | 登录 |
| `GET /api/auth/status` | 无 | 检查认证状态 |
| `/api/events` | JWT | SSE 支持 Query 传 token |
| 其他 `/api/*` | JWT | Header 传 Bearer token |

## Socket.IO 认证

**文件**: [`hub/src/socket/server.ts`](/hub/src/socket/server.ts)

Socket.IO 通过命名空间隔离，认证逻辑与 HTTP 相同，但传递方式不同：

| 命名空间 | 认证 | 使用者 | Token 传递 |
|----------|------|--------|------------|
| `/cli` | Access Token | CLI 客户端 | `auth.token`（handshake） |
| `/terminal` | JWT | Web 终端 | `auth.token`（handshake） |

```typescript
// 客户端连接示例
import { io } from 'socket.io-client'

// CLI 连接
const cliSocket = io('/cli', {
    auth: { token: 'your-access-token' }
})

// Terminal 连接
const terminalSocket = io('/terminal', {
    auth: { token: 'your-jwt' }
})
```

### /cli 命名空间

```mermaid
flowchart TB
    connect[连接 /cli] --> auth{auth.token?}
    auth -->|无| reject[拒绝连接]
    auth -->|有| parse[解析 Access Token]
    parse --> validate{验证 Token}
    validate -->|无效| reject
    validate -->|有效| setns[设置 namespace]
    setns --> success[连接成功]
```

### /terminal 命名空间

```mermaid
flowchart TB
    connect[连接 /terminal] --> auth{auth.token?}
    auth -->|无| reject[拒绝连接]
    auth -->|有| verify{验证 JWT}
    verify -->|无效| reject
    verify -->|有效| setdata[设置 userId, namespace]
    setdata --> success[连接成功]
```

## CLI 认证（Access Token）

**文件**: [`hub/src/web/routes/cli.ts`](/hub/src/web/routes/cli.ts)

CLI 路由通过中间件验证 Access Token：

```mermaid
flowchart TB
    A[请求 /cli/*] --> B{Authorization Header?}
    B -->|无| C[401 Missing Authorization]
    B -->|有| D{Bearer Token 格式?}
    D -->|无效| E[401 Invalid Authorization header]
    D -->|有效| F{验证 Access Token}
    F -->|无效| G[401 Invalid token]
    F -->|有效| H[设置 namespace]
    H --> I[继续处理请求]
```

- Token 格式：`Authorization: Bearer <accessToken>`
- Access Token 即 CLI_API_TOKEN（可带 namespace 前缀）

## Web 认证（JWT）

### 登录流程

**文件**: [`hub/src/web/routes/auth.ts`](/hub/src/web/routes/auth.ts)

```mermaid
flowchart TB
    A[POST /api/auth] --> B{验证 accessToken}
    B -->|无效| C[401 Invalid access token]
    B -->|有效| D[生成 JWT]
    D --> E[返回 token + user]
```

- 输入：`accessToken`（即 CLI_API_TOKEN）
- 输出：JWT（有效期 1 天）+ 用户信息

### JWT 中间件

**文件**: [`hub/src/web/middleware/auth.ts`](/hub/src/web/middleware/auth.ts)

```mermaid
flowchart TB
    A[请求 /api/*] --> B{路径判断}
    B -->|/api/auth 或 /api/bind| C[跳过认证]
    B -->|其他| D[获取 Token]

    D --> E{Token 来源}
    E -->|Header| F[Bearer token]
    E -->|Query /api/events| G[?token=xxx]

    F --> H{验证 JWT}
    G --> H
    H -->|失败| I[401 Invalid token]
    H -->|成功| J[设置 userId, namespace]
    J --> K[继续处理请求]
```

### JWT Payload

```typescript
{
    uid: number,    // 用户 ID
    ns: string      // 命名空间
}
```

## 密钥来源

### CLI_API_TOKEN（Access Token）

**文件**: [`hub/src/config/cliApiToken.ts`](/hub/src/config/cliApiToken.ts)

| 优先级 | 来源 | 说明 |
|--------|------|------|
| 1 | 环境变量 `CLI_API_TOKEN` | 最高优先级 |
| 2 | 配置文件 `~/.mobi/settings.json` | 持久化存储 |
| 3 | 自动生成 | 首次启动时生成并保存 |

首次启动时会打印到控制台：
```
======================================================================
  NEW CLI_API_TOKEN GENERATED
======================================================================
  Token: xxxxxxxx
  Saved to: ~/.mobi/settings.json
======================================================================
```

### JWT Secret

**文件**: [`hub/src/config/jwtSecret.ts`](/hub/src/config/jwtSecret.ts)

| 来源 | 说明 |
|------|------|
| 文件 `~/.mobi/jwt-secret.json` | 首次启动时自动生成（32字节随机数） |

文件格式：
```json
{
    "secretBase64": "base64编码的32字节密钥"
}
```
