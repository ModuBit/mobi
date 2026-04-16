# cli

客户端，在本地启动 Claude Code 会话并通过 Hub 实现远程控制。

## 编码规范

→ [docs/conventions/cli.md](../docs/conventions/cli.md)

## 关键文件

| 文件 | 职责 |
|------|------|
| `src/index.ts` | 主入口 |
| `src/commands/runCli.ts` | CLI 启动流程 |
| `src/commands/registry.ts` | 命令注册表 |
| `src/commands/claude.ts` | 默认命令，启动 Claude 会话 |
| `src/claude/loop.ts` | 会话循环（Local/Remote 模式切换） |

## 测试

→ [docs/conventions/testing.md](../docs/conventions/testing.md)

- 框架：vitest
- 运行：`bun test`

## 架构文档

→ [docs/architecture/cli/](../docs/architecture/cli/)
