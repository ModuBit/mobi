# session

会话宿主：与 Claude Code 会话进程共处的一切——claude/（Local/Remote 循环、SDK 消息装配、rewind/compact/output style 等 utils）、agent/（会话工厂与生命周期）、api/apiSession（CLI↔hub 会话通道）、mcp/（会话侧 MCP 工具族与 transport 装配）、modules/{sandbox,watcher} 与 common/{hooks,launcher,permission,remote,session,idleTimer}、terminal/（TerminalManager，19 票前暂在此）、ui/ink 与 terminalState/messageFormatterInk、webtools/server（web 工具 server 组装，registry 在 node-core）。

依赖方向：只依赖 `@mobi/node-core` 与 `@mobi/shared`，禁止依赖 daemon / cli / web（daemon ⟂ session）。

## 关键入口

- `src/claude/runClaude.ts` — 会话进程主入口（cli `commands/claude.ts` 经 `@mobi/session/claude/runClaude` 动态 import）
- `src/api/apiSession.ts` — CLI↔hub 会话通道（ApiSessionClient.create）
- `src/mcp/mobiAppsServer.ts` / `mobiCoreServer.ts` — 会话侧 MCP 工具族

## 测试

- 框架：vitest
- 运行：`bun run test:session`（根目录）
- tests 不入 tsc program（tsconfig 只 include src，与 cli 时代语义一致）

## 编码规范

→ [docs/conventions/](../../docs/conventions/)（14 票文档路径同步）
