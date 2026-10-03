# Runner 命令（会话管理工具族）

`mobi runner` 是会话管理工具族入口，只剩三个子命令：`list` / `stop-session` / `logs`。

**入口文件**: [`packages/cli/src/commands/runner.ts`](/packages/cli/src/commands/runner.ts)

> **进程拓扑已变（personal-agent-rewrite）**：runner 与 hub 同进程合并为单机 daemon，进程级 start/stop/restart/status 子命令与 `runner.state.json` 已退场——进程操作走 `mobi daemon` / `mobi service`，进程状态单源是 `daemon.state.json`。runner 的**内部结构**（spawn 管线、controlServer、worktree、spawnDedup）完整保留，现位于 [`packages/daemon/src/runner/`](/packages/daemon/src/runner/)，下述内部文档继续有效。

## 子命令

| 子命令 | 说明 | 文档 |
|--------|------|------|
| `list` | 列出活跃会话 | [list.md](./list.md) |
| `stop-session <id>` | 停止指定会话 | [stop-session.md](./stop-session.md) |
| `logs` | 显示最新 daemon 日志路径 | [logs.md](./logs.md) |

## Runner 内部结构（daemon 进程内）

原 runner 的核心机制文档，源码在 `packages/daemon/src/runner/`：

- [controlServer.md](./controlServer.md) — runner 对外暴露的 HTTP API（同进程后由 daemonEntry 装配，daemon 内部通道）
- [spawn-session.md](./spawn-session.md) — **核心中的核心**：会话子进程创建全流程（webhook 判据、awaiter、worktree、spawnDedup）
- [controlClient.md](./controlClient.md) — 命令如何与 controlServer 通信
- [doctor.md](./doctor.md) — 进程诊断与清理

### 术语表（内部结构语境）

| 术语 | 含义 |
|------|------|
| **ControlServer** | runner 内置的 HTTP 服务器，监听 `127.0.0.1` 随机端口（端口记录在 `daemon.state.json` 的 `runnerHttpPort`） |
| **controlClient** | CLI 侧的 HTTP 客户端，各命令通过它与 runner 通信 |
| **Webhook** | 子会话启动后通过 `POST /session-started` 向 runner 报告自己的存在 |
| **TrackedSession** | runner 内部的会话追踪数据结构，以 PID 为 key |
| **Awaiter** | spawnSession 中的等待机制，子进程启动后等待 Webhook 确认 |
| **Worktree** | Git Worktree，为会话创建独立的工作目录和分支 |
| **僵尸会话** | 已退出但未被正常清理的会话，由心跳定时器兜底清理 |
| **失控进程** | daemon 或其子进程异常残留，由 doctor 命令发现和清理 |
