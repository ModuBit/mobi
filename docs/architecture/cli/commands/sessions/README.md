# Sessions 命令 — 会话管理工具族

文件 [`packages/cli/src/commands/sessions.ts`](/packages/cli/src/commands/sessions.ts)

`mobi sessions` 是会话管理工具族（daemon 收敛退场后承接原 `mobi runner` 命令面）。会话运行在 daemon 内，进程级操作走 [`mobi daemon`](../daemon/) / [`mobi service`](../service/)。

## 子命令

| 子命令 | 说明 |
|--------|------|
| `list` | 列出 daemon 感知的活跃会话（经宿主通道 RPC `listExecutorSessions`） |
| `stop <id>` | 停止指定会话（经宿主通道 RPC `stopExecutorSession`） |

daemon 未运行时两个子命令均打印 `No daemon running`。

## 实现要点

- 不经 supervisor，直接与 daemon 宿主通道（loopback `/cli/*` HTTP）通信
- 会话生命周期管理核心在 daemon executor（`listExecutorSessions` / `stopExecutorSession`，见 [daemon executor 架构](../../../daemon/)）
- 日志查看走 `mobi logs`，不在本命令族
