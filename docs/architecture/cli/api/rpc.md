# RPC 系统 (`rpc/`)

通用的双向 RPC 基础设施，支持 CLI 侧注册方法供 Hub 远程调用。

## 文件结构

```
rpc/
├── RpcHandlerManager.ts   // RPC 方法注册与分发
└── types.ts               // 类型定义
```

## 类型定义

```typescript
// RPC 处理函数
type RpcHandler<TRequest, TResponse> = (data: TRequest) => TResponse | Promise<TResponse>

// 方法注册表
type RpcHandlerMap = Map<string, RpcHandler>

// 请求结构（来自 Hub）
interface RpcRequest {
    method: string    // 方法名（含 scope 前缀）
    params: string    // JSON 字符串
}

// 管理器配置
interface RpcHandlerConfig {
    scopePrefix: string   // 作用域前缀（sessionId 或 machineId）
    logger?: (msg, data?) => void
}
```

## RpcHandlerManager

### 核心方法

| 方法 | 说明 |
|------|------|
| `registerHandler(method, handler)` | 注册方法处理函数 |
| `handleRequest(request)` | 接收并执行 RPC 请求 |
| `onSocketConnect(socket)` | Socket 连接后批量注册方法 |
| `onSocketDisconnect()` | Socket 断开后清理引用 |
| `getHandlerCount()` | 已注册方法数 |
| `hasHandler(method)` | 检查方法是否已注册 |
| `clearHandlers()` | 清空所有注册 |

### 方法名格式

```
{scopePrefix}:{method}
```

示例:
- `session-abc123:bash-exec`
- `machine-hostname:path-exists`

### 请求处理流程

```
Hub 发送 rpc-request { method, params: JSON }
    │
    ▼
handleRequest(request)
    │
    ├── 查找 handler → 未找到 → { error: 'Method not found' }
    │
    ├── JSON.parse(params) → 解析失败 → null
    │
    ├── await handler(params)
    │
    └── 返回 JSON.stringify(result)
        │
        ├── 成功 → { ...result }
        └── 异常 → { error: message }
```

### Socket 连接管理

```
onSocketConnect(socket)
    ├── 保存 socket 引用
    └── 遍历所有已注册方法 → socket.emit('rpc-register', { method })
        （通知 Hub 当前可用的 RPC 方法）

onSocketDisconnect()
    └── 清空 socket 引用
```

新注册方法时，如果 socket 已连接，立即发送 `rpc-register`。

## 使用场景

### Session 级 RPC（ApiSessionClient）

通过 `registerCommonHandlers` 注册，供 Hub（Web 端）调用：

| 方法 | 模块 | 说明 |
|------|------|------|
| `bash-exec` | handlers/bash | 执行 bash 命令 |
| `file-read` | handlers/files | 读取文件 |
| `file-write` | handlers/files | 写入文件 |
| `git-*` | handlers/git | Git 操作 |
| `rg-search` | handlers/ripgrep | Ripgrep 搜索 |
| `skill-*` | handlers/skills | Skill 管理 |
| `diff-*` | handlers/difftastic | Diff 操作 |
| `dir-*` | handlers/directories | 目录操作 |
| `slash-*` | handlers/slashCommands | 斜杠命令 |
| `upload-*` | handlers/uploads | 文件上传 |

### Machine 级 RPC（ApiMachineClient）

| 方法 | 说明 |
|------|------|
| `spawn-mobi-session` | 创建新的 Claude 会话 |
| `stop-session` | 停止指定会话 |
| `stop-runner` | 停止 Runner 进程 |
| `path-exists` | 检查路径是否存在 |
| + 所有 common handlers | 同 Session 级 |

## 设计要点

1. **无加密**: 与 HAPI 不同，Mobi 的 RPC 不使用加密层（信任内部网络）
2. **Scope 隔离**: 通过 scopePrefix 确保 Session/Machine 的方法名不冲突
3. **JSON 透传**: params 和 result 都是 JSON 字符串，类型安全由各 handler 自行保证
4. **动态注册**: 支持运行时注册/注销方法，Socket 重连后自动重新声明
