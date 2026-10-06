# CLI 路由

**文件**: [`packages/daemon/src/web/routes/cli.ts`](/packages/daemon/src/web/routes/cli.ts)

CLI 专用的 HTTP API，用于会话和机器的初始化与查询。

## 认证

使用 Bearer Token 认证，Token 格式为 Access Token（包含 namespace 信息）。

```mermaid
flowchart LR
    request[请求] --> header[Authorization: Bearer xxx]
    header --> parse[解析 Access Token]
    parse --> validate{验证 baseToken}
    validate -->|失败| err[401 Invalid token]
    validate -->|成功| namespace[提取 namespace]
    namespace --> next[继续处理]
```

## 路由总览

| 方法 | 路径 | 功能 |
|------|------|------|
| POST | `/cli/sessions` | 创建或加载会话 |
| GET | `/cli/sessions/by-claude-session/:claudeSessionId` | 通过 Claude Session ID 查找 |
| GET | `/cli/sessions/:id` | 获取会话 |
| GET | `/cli/sessions/:id/messages` | 获取消息列表 |
| GET | `/cli/web-token` | 读取当前 webApiToken + `envOverride` 标志 |
| POST | `/cli/web-token` | 轮换 webApiToken（落盘 + 热更新 configuration） |

## web-token（远程轮换）

webApiToken 归 daemon 所有（`settings.daemon.json`），cli 与 daemon 可不同机器部署，
cli 经此 API 代行原「直接写文件」的轮换语义（`mobi auth web-token` / `rotate-web-token`）。

```
GET  /cli/web-token  → { webToken: string, envOverride: boolean }
POST /cli/web-token  → { webToken: string, envOverride: boolean }
```

- `envOverride: true`：daemon 以 `WEB_API_TOKEN` 环境变量运行，重启后轮换会被 env 值覆盖（POST 在轮换**前**取值）
- POST 复用 [`webApiToken.ts`](/packages/daemon/src/config/webApiToken.ts) 的 `rotateWebApiToken()` 持久化，随后 `_setWebApiToken()` 即时热更新 configuration 单例（不等 settingsWatcher）

## 会话操作

### 创建/加载会话

```
POST /cli/sessions
```

**请求体**：

```typescript
{
    tag: string,            // 会话标签
    metadata: unknown,      // 会话元数据
    agentState?: unknown,   // Agent 状态（可选）
    mode?: 'local' | 'remote',
    runtimeState?: unknown,
    workspaceId?: string      // 归属工作区（Web spawn 透传；缺省 = 游离）
}
```

**响应**：

```json
{ "session": { ... }, "workspace": { ... } }
```

`workspace` 为会话归属的工作区实体（未归属时为 `null`），CLI 据此校验归属并把 folders 冻结进 `metadata.additionalDirectories`。

**错误**：

| 状态码 | 说明 |
|--------|------|
| 404 | Workspace not found（workspaceId 不存在或不属于当前 namespace） |
| 403 | Workspace access denied（工作区归属校验按 namespace） |

调用 `SyncEngine.getOrCreateSession()`，根据 tag 查找或创建会话。

### 通过 Claude Session ID 查找

```
GET /cli/sessions/by-claude-session/:claudeSessionId
```

**响应**：

```json
{ "session": { ... } }
```

**错误**：404 Session not found

调用 `SyncEngine.getSessionByClaudeSessionId()`。

### 获取会话

```
GET /cli/sessions/:id
```

**响应**：

```json
{ "session": { ... } }
```

**错误**：

| 状态码 | 说明 |
|--------|------|
| 403 | Session access denied |
| 404 | Session not found |

### 获取消息列表

```
GET /cli/sessions/:id/messages?afterSeq=0&limit=200
```

**查询参数**：

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| afterSeq | number | 必填 | 起始序列号 |
| limit | number | 200 | 最大返回数量 |

**响应**：

```json
{ "messages": [ ... ] }
```

## 命名空间隔离

所有操作都基于 namespace 进行隔离，确保不同 CLI 客户端只能访问自己的数据。

```mermaid
flowchart TB
    subgraph 辅助函数
        resolveSession["resolveSessionForNamespace()"]
    end

    subgraph SyncEngine
        getAccess["resolveSessionAccess()"]
    end

    resolveSession --> getAccess

    getAccess -->|"ok: true"| returnSession[返回会话]
    getAccess -->|"reason: access-denied"| err403[403 错误]
    getAccess -->|"reason: not-found"| err404[404 错误]
```

## 与 SyncEngine 交互

```mermaid
sequenceDiagram
    participant CLI
    participant CliRoutes
    participant SyncEngine

    CLI->>CliRoutes: POST /cli/sessions
    CliRoutes->>SyncEngine: getOrCreateSession()
    SyncEngine-->>CliRoutes: Session
    CliRoutes-->>CLI: { session }

    CLI->>CliRoutes: GET /cli/sessions/:id/messages
    CliRoutes->>SyncEngine: resolveSessionAccess()
    SyncEngine-->>CliRoutes: 验证通过
    CliRoutes->>SyncEngine: getMessagesAfter()
    SyncEngine-->>CliRoutes: Messages
    CliRoutes-->>CLI: { messages }
```

## 响应头

所有响应都包含协议版本头：

```
X-Mobi-Protocol-Version: <version>
```
