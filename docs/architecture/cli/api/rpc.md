# RPC 系统 (`rpc/`)

通用的双向 RPC 基础设施，支持 CLI 侧注册方法供 daemon 远程调用。

## 文件结构

```
packages/node-core/src/rpc/
├── RpcHandlerManager.ts   // RPC 方法注册与分发
└── types.ts               // 类型定义
```

## 类型定义

```typescript
// RPC 处理函数
type RpcHandler<TRequest, TResponse> = (data: TRequest) => TResponse | Promise<TResponse>

// 方法注册表
type RpcHandlerMap = Map<string, RpcHandler>

// 请求结构（来自 daemon）
interface RpcRequest {
    method: string    // 方法名（含 scope 前缀）
    params: string    // JSON 字符串
}

// 管理器配置
interface RpcHandlerConfig {
    scopePrefix: string   // 作用域前缀（sessionId）
    logger?: (msg, data?) => void
}

// RPC 处理器选项
interface RpcHandlerOptions {
    skipIdleTimerReset?: boolean  // 是否跳过空闲计时器重置，默认 false
}
```

## RpcHandlerManager

### 核心方法

| 方法 | 说明 |
|------|------|
| `registerHandler(method, handler, options?)` | 注册方法处理函数，支持 skipIdleTimerReset 元数据 |
| `handleRequest(request)` | 接收并执行 RPC 请求 |
| `onSocketConnect(socket)` | Socket 连接后批量注册方法 |
| `onSocketDisconnect()` | Socket 断开后清理引用 |
| `setOnRpcCalled(callback)` | 设置 RPC 调用回调（用于重置空闲计时器） |
| `getHandlerCount()` | 已注册方法数 |
| `hasHandler(method)` | 检查方法是否已注册 |
| `clearHandlers()` | 清空所有注册 |

### 方法名格式

```
{scopePrefix}:{method}
```

示例:
- `session-abc123:abort`
- `session-abc123:set-session-config`

### 请求处理流程

```
daemon 发送 rpc-request { method, params: JSON }
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
        （通知 daemon 当前可用的 RPC 方法）

onSocketDisconnect()
    └── 清空 socket 引用
```

新注册方法时，如果 socket 已连接，立即发送 `rpc-register`。

## 使用场景

### Session 级 RPC（ApiSessionClient）

两类注册：

**common handlers**（`registerCommonHandlers`，见 [common-rpc](./common-rpc/README.md)）：files / difftastic / commands / uploads / sessionFiles 五族，供 daemon（Web 端）调用。

**会话控制**（claudeRemoteLauncher / runClaude 等各自注册）：

| 方法 | 说明 |
|------|------|
| `abort` | 中止当前轮次 |
| `switch` | remote/local 模式切换 |
| `set-session-config` | 会话配置（权限模式等） |
| `rename-session` | 重命名会话 |
| `switch-output-style` | 切换 output style |
| `rewind` / `rewind-dry-run` | 回退轮次（含预检） |
| `stop-task` | 停止后台任务 |
| `cancel-queued-message` / `steer-queued-message` | 排队消息取消 / 追加改写 |
| `killSession` | 停止会话进程 |
| `dormancyCheck` | 休眠 gate 评估 |
| `permission` | 权限审批应答 |

## 设计要点

1. **无加密**: 与 HAPI 不同，Mobi 的 RPC 不使用加密层（信任内部网络）
2. **Scope 隔离**: 通过 scopePrefix（sessionId）隔离不同会话的方法名
3. **JSON 透传**: params 和 result 都是 JSON 字符串，类型安全由各 handler 自行保证
4. **动态注册**: 支持运行时注册/注销方法，Socket 重连后自动重新声明
