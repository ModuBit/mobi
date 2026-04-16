# CLI 编码规范

适用于 `cli/` 包（Bun + Ink + Claude Agent SDK）。

## 命令体系

### 命令定义

所有命令实现 `CommandDefinition` 接口：

```typescript
type CommandDefinition = {
    name: string
    requiresRuntimeAssets: boolean
    run: (context: CommandContext) => Promise<void>
}
```

- 命令文件放在 `src/commands/`，一个命令一个文件
- 在 `src/commands/registry.ts` 中注册
- 未匹配子命令时 fallback 到 `claudeCommand`

### 命令上下文

```typescript
type CommandContext = {
    args: string[]
    subcommand?: string
    commandArgs?: string[]
}
```

## Claude SDK 集成

### 消息转换

SDK 消息通过 `sdkToLogConverter.ts` 转换为 `RawJSONLines` 格式：

- 使用 `RawJSONLinesSchema`（Zod）进行运行时校验
- UUID 链式追踪：主链 `lastUuid` + 子链 `sidechainLastUUID`
- `result` 类型消息在转换层丢弃（非对话内容）

### 会话工厂

通过 `sessionFactory.ts` 的 `bootstrapSession()` 创建会话：

- 根据参数选择 Local/Remote 模式
- 支持 `--resume` / `-r` 恢复已有会话

### 权限处理

`PermissionHandler` 管理权限审批：

- 支持 `default`、`bypassPermissions`、`plan` 等模式
- 通过 RPC 接收 Web 端的审批/拒绝指令

## API 通信

### HTTP + Socket.IO

- `ApiClient.create()` 单例模式
- Socket.IO 事件使用严格类型接口
- 认证：Token-based（`clientType` 区分 `session-scoped` / `machine-scoped`）

### RPC 模式

- RPC 方法通过 `RpcHandlerManager` 注册，带 `sessionId:method` 前缀隔离
- 请求-响应通过 Socket.IO 事件实现

### 消息队列

- `SocketOutbox`：带大小限制和过期的发送队列
- `MessageQueue<T>`：按模式批量处理的消息队列
- 版本化更新：乐观并发控制，版本号追踪状态/元数据变更

## 错误处理

- `extractErrorInfo()` 统一错误信息提取
- `isRetryableConnectionError()` 判断可重试错误（ECONNREFUSED、ETIMEDOUT、5xx）
- 连接 Hub 失败时自动降级为本地模式（`runLocalMode`）

## 进程管理

- Runner 后台进程通过 `spawnMobiCli()` 启动（detached 模式）
- 锁文件管理：`acquireRunnerLock()` 防止多实例
- 信号处理：注册 `SIGINT`、`SIGTERM`、`uncaughtException`、`unhandledRejection`
- 健康检查：定期心跳 + 过期会话清理

## 配置

- 单例 `Configuration` 类（`src/configuration.ts`）
- 优先级：环境变量 > `~/.mobi/settings.json` > 默认值
- 关键环境变量：`MOBI_API_URL`、`CLI_API_TOKEN`、`MOBI_HOME`、`MOBI_EXPERIMENTAL`

## 路径别名

使用 `@/*` 映射到 `src/*`：

```typescript
import { configuration } from '@/configuration'
import { extractErrorInfo } from '@/lib'
```

## 测试

- 测试框架：Vitest
- 测试目录：`cli/tests/`（与源码分离）
- Mock 外部依赖（SDK、Socket.IO）
- 测试运行：`bun run test`（根目录）
