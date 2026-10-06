# daemon

单机自足 daemon：原 hub（Hono Web + Socket.IO + SQLite store/sync + SSE + push）+ runner（spawn 管线 / controlServer / worktree / spawnDedup）合并为**一个进程**（16 票同进程化，22 票收尾），machine 层本地化（LocalMachineHost，17/18 票）。会话子进程经宿主通道（loopback-only 独立 listener，`/cli` socket + `/cli/*` HTTP，端口 = 主端口 + 10000）回连本进程。

依赖方向：只依赖 `@mobi/node-core` 与 `@mobi/shared`，禁止依赖 session / cli / web。

## 关键入口

- `src/daemonEntry.ts` — daemon 唯一入口（cli `commands/daemon.ts` 的 `start-sync` 经 `@mobi/daemon/daemonEntry` 动态 import 启动）：主端口 + 宿主通道双 listener 装配 + 同进程 runner 编排 + 写 `daemon.state.json`
- `src/server.ts` — 双 listener（主端口 Web + 宿主通道）装配
- `src/executor/` — 同进程执行器（spawn 管线 / controlServer / worktree / spawnDedup / doctor）
- `scripts/generate-embedded-web-assets.ts` — web 静态资产嵌入生成（build:exe 调）

## 测试

双运行器（`test` 脚本串联两者）：

- `tests/server/` — bun 内置运行器（原 hub 包测试，`--parallel`；602 起目录名定稿）
- `tests/executor/` 及其余 — vitest

运行：`bun run test:daemon`（根目录）。

## 编码规范

→ [docs/conventions/](../../docs/conventions/)（hub 侧见 [daemon.md](../../docs/conventions/daemon.md)）
