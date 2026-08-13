# cli

客户端，在本地启动 Claude Code 会话并通过 Hub 实现远程控制。

## 编码规范

→ [docs/conventions/cli.md](../../docs/conventions/cli.md)

## 关键文件

| 文件 | 职责 |
|------|------|
| `src/index.ts` | 主入口 |
| `src/commands/runCli.ts` | CLI 启动流程 |
| `src/commands/registry.ts` | 命令注册表 |
| `src/commands/claude.ts` | 默认命令，启动 Claude 会话 |
| `src/commands/claudeArgs.ts` | claude 命令参数解析（parseStartOptions 纯函数，含 --project） |
| `src/runner/spawnArgs.ts` | runner spawn 子进程 CLI 参数构建（buildClaudeSpawnArgs 纯函数） |
| `src/claude/loop.ts` | 会话循环（Local/Remote 模式切换） |
| `src/modules/common/idleTimer.ts` | Session 自动超时计时器 |
| `src/constants/uploadPaths.ts` | 上传文件路径常量（`.mobi/uploads`） |
| `src/modules/common/handlers/uploads.ts` | 文件上传/删除 RPC Handler |

## 已知陷阱

### BUN_INSPECT 导致 Claude Code 子进程异常退出

VS Code Bun 调试器会注入 `BUN_INSPECT` / `BUN_INSPECT_NOTIFY` 环境变量。这些变量被子进程继承后，子进程尝试绑定同一调试 socket，导致 exit code 1。

**症状**：SDK `query()` spawn 的 Claude Code 子进程报 `"Claude Code process exited with code 1"`，无其他有用信息。

**解法**：所有通过 SDK 或 `spawn` 启动子进程的地方，必须用 `stripBunDebuggerEnv` 清理传给子进程的 env。参考 `spawnMobiCli.ts`、`metadataExtractor.ts`、`claudeRemote.ts`。

## 测试

→ [docs/conventions/testing.md](../../docs/conventions/testing.md)

- 框架：vitest
- 运行：`bun test`

## 架构文档

→ [docs/architecture/cli/](../../docs/architecture/cli/)
