# Local 模式

Local 模式是 Claude 命令的基础模式：直接 spawn Claude 进程，用户在终端与 Claude 交互。Mobi 作为旁观者，通过监听 JSONL 文件将消息同步到 daemon。

---

## 架构

```mermaid
flowchart TB
    subgraph CLI["CLI 进程"]
        Launcher["claudeLocalLauncher()"]
        Scanner["SessionScanner<br/>监听 JSONL"]
        BaseLauncher["BaseLocalLauncher<br/>通用启动框架"]
    end

    subgraph ClaudeProcess["Claude 子进程"]
        Claude["claude CLI<br/>原生终端交互"]
        JSONL["JSONL 会话文件<br/>~/.claude/workspaces/.../"]
    end

    subgraph DaemonSide["daemon 侧"]
        daemon["daemon 服务器"]
        Web["Web 前端"]
    end

    Launcher --> BaseLauncher
    BaseLauncher --> Claude
    Claude -->|"写入会话"| JSONL
    JSONL -->|"监听"| Scanner
    Scanner -->|"sendClaudeSessionMessage()"| daemon
    daemon -->|"SSE 推送"| Web

    daemon -->|"RPC: abort/switch"| BaseLauncher
    BaseLauncher -->|"终止/切换"| Claude
```

## 启动流程

### claudeLocalLauncher

**文件**: `packages/session/src/claude/claudeLocalLauncher.ts`

```mermaid
flowchart TB
    Start["claudeLocalLauncher(session)"] --> Scanner["createSessionScanner()<br/>创建 JSONL 监听器"]
    Scanner --> Callback["注册 sessionFound 回调"]
    Callback --> Base["new BaseLocalLauncher(opts)"]
    Base --> Run["launcher.run()"]
    Run --> Cleanup["清理: 移除回调, scanner.cleanup()"]
    Cleanup --> Return["返回 'switch' | 'exit'"]
```

Launcher 配置：

| 配置项 | 值 | 说明 |
|--------|-----|------|
| `launch` | `claudeLocal()` | 实际的 spawn 函数 |
| `queue` | `session.queue` | MessageQueue 实例 |
| `rpcHandlerManager` | `session.client.rpcHandlerManager` | 用于注册 abort/switch RPC |
| `startedBy` / `startingMode` | 来自 Session | 决定退出行为 |
| `onLaunchSuccess` | `session.consumeOneTimeFlags()` | 消费 --resume 等一次性参数 |

### BaseLocalLauncher.run()

**文件**: `packages/session/src/modules/common/launcher/BaseLocalLauncher.ts`

```mermaid
flowchart TB
    Start["run()"] --> RegisterRPC["注册 RPC: abort, switch"]
    RegisterRPC --> SetQueue["设置 queue.onMessage<br/>收到消息 → trigger switch"]
    SetQueue --> Check{"已有退出原因?"}
    Check -->|是| Return1["返回 exitReason"]
    Check -->|否| Check2{"队列有消息?"}
    Check2 -->|是| Switch["exitReason = 'switch'<br/>触发 Remote"]
    Check2 -->|否| Launch["launch(abortSignal)<br/>spawn Claude"]
    Launch --> Success{"启动成功?"}
    Success -->|是| Consume["consumeOneTimeFlags()<br/>exitReason = 'exit'"]
    Success -->|否| Error["recordLocalLaunchFailure()"]
    Error --> Policy{"退出策略?"}
    Policy -->|"daemon + local"| Retry["强制改 remote"]
    Policy -->|"其他"| SwitchToRemote["exitReason = 'switch'"]

    Consume --> Return2["返回 exitReason"]
    Retry --> Launch
    SwitchToRemote --> Return3["返回 'switch'"]
```

**退出策略**：
- `startedBy === 'daemon' && startingMode === 'local'` → 强制改 remote（daemon spawn 的会话不允许 local/交互模式，runClaude 启动时守卫）
- 其他场景 → 返回 `'switch'`，触发模式切换到 Remote

## claudeLocal — Spawn Claude 进程

**文件**: `packages/session/src/claude/claudeLocal.ts`

```mermaid
flowchart TB
    Start["claudeLocal(opts)"] --> Dir["mkdirSync(workspaceDir)<br/>确保工作区目录存在"]
    Dir --> CheckFlags{"用户已有<br/>--continue/--resume?"}
    CheckFlags -->|是| SkipResume["跳过自动 resume"]
    CheckFlags -->|否| CheckSession{"sessionId 有效?<br/>claudeCheckSession()"}
    CheckSession -->|是| SetResume["startFrom = sessionId<br/>使用 --resume"]
    CheckSession -->|否| Fresh["startFrom = null<br/>新会话"]

    SkipResume --> BuildArgs
    SetResume --> BuildArgs["构建 Claude 参数"]
    Fresh --> BuildArgs

    BuildArgs --> Args["参数列表:<br/>--resume <id> (如有)<br/>--append-system-prompt<br/>--mcp-config<br/>--allowedTools<br/>--settings (hook)<br/>--add-dir (blobs + 附加目录)<br/>其他 claudeArgs"]

    Args --> Spawn["spawnWithAbort(claude, args)<br/>启动 Claude 进程"]
    Spawn --> Wait["等待进程退出"]
    Wait --> Cleanup["清理 MCP 配置文件"]
    Cleanup --> Resume["恢复 stdin 和终端状态"]
```

### Claude 进程参数

| 参数 | 说明 |
|------|------|
| `--resume <id>` | 恢复已有会话（仅当 sessionId 有效时） |
| `--append-system-prompt` | 追加 mobi 系统提示词 |
| `--mcp-config` | MCP 服务器配置（mobi MCP Server） |
| `--allowedTools` | 允许的工具列表 |
| `--settings` | Hook 配置文件路径 |
| `--add-dir` | 添加 blobs 目录（用于文件上传）+ 会话附加目录（`opts.additionalDirectories`，来自工作区 folders / metadata 冻结值） |
| 其他 `claudeArgs` | 用户透传的 Claude 参数 |

### 环境变量

```typescript
{
    ...process.env,
    DISABLE_AUTOUPDATER: '1',    // 禁止 Claude 自动更新
    ...opts.claudeEnvVars          // 自定义环境变量
}
```

## SessionScanner — JSONL 监听

**文件**: `packages/session/src/claude/utils/sessionScanner.ts`

SessionScanner 在 Local 模式下监听 Claude 写入的 JSONL 会话文件，将消息转发到 daemon：

```mermaid
flowchart TB
    Start["createSessionScanner()"] --> Watch["监听工作区目录<br/>~/.claude/workspaces/{hash}/"]
    Watch --> Detect["检测 .jsonl 文件变化"]
    Detect --> Parse["解析 JSONL 行<br/>RawJSONLinesSchema 验证"]
    Parse --> Filter{"过滤内部事件?"}
    Filter -->|"summary 等"| Skip["跳过"]
    Filter -->|"正常消息"| Forward["onMessage()<br/>sendClaudeSessionMessage()"]

    subgraph SessionTracking["会话追踪"]
        Pending["pending 文件<br/>正在写入"] --> Finished["finished 文件<br/>会话结束"]
    end

    Detect -->|"新 .jsonl 出现"| SessionFound["onNewSession(sessionId)<br/>通知 Session"]
```

**消息过滤**：
- 跳过 `summary` 类型消息（Mobi 自己生成摘要）
- 保留 `user`、`assistant`、`tool_result` 等正常消息

**会话追踪**：
- `pending` 文件 — Claude 正在写入的会话
- `finished` 文件 — 会话已结束
- 新文件出现时触发 `onNewSession` 回调，更新 Session ID

## daemon 侧消息流

Local 模式下的完整消息流：

```
Claude 进程
    │
    ├── 写入 JSONL 文件（~/.claude/workspaces/{hash}/{sessionId}.jsonl）
    │
    └── SessionScanner 监听文件变化
         │
         ├── 解析 JSONL 行
         ├── 过滤内部事件
         └── session.client.sendClaudeSessionMessage(message)
              │
              └── Socket.IO emit → daemon
                   │
                   ├── SyncEngine 接收
                   ├── EventPublisher 广播
                   └── SSE → Web 前端
```

## Local → Remote 切换触发

Local 模式在以下场景切换到 Remote：

| 触发方式 | 说明 |
|----------|------|
| **daemon 消息到达** | `queue.onMessage` 回调触发，用户通过 Web 发送消息 |
| **RPC switch** | daemon 侧发送 `switch` RPC 请求 |
| **RPC abort** | daemon 侧发送 `abort` RPC，终止当前 Claude 进程 |
| **Claude 进程退出** | 非 daemon 启动的会话，启动失败时切换到 Remote |

## 与 Remote 模式的关键差异

| 维度 | Local | Remote |
|------|-------|--------|
| Claude 进程 | 独立子进程，直连终端 | SDK 内嵌，消息通过 API |
| 消息获取 | SessionScanner 监听 JSONL | SDK `for await` 迭代 |
| 消息发送到 daemon | `sendClaudeSessionMessage()` | `OutgoingMessageQueue` 有序发送 |
| 权限审批 | Claude 自行处理 | `PermissionHandler` + daemon 审批 |
| 终端 UI | Claude 原生界面 | Ink 自定义界面 |
| 进程管理 | `spawnWithAbort()` | SDK `AbortController` |
