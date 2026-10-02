# daemon

单机 daemon：原 hub（Hono Web + Socket.IO + SQLite store/sync + SSE + push）+ runner（spawn 管线 / controlServer / worktree / spawnDedup / apiMachine / authSetup）合并落点；进程拓扑不变（hub、runner 仍是两个进程，16 票同进程化）。machine 层 handlers（files/uploads/gitReview/webToolsConfig 等）与 registerCommonHandlers 归 @mobi/node-core（session 与 daemon 双侧共用）。

依赖方向：只依赖 `@mobi/node-core` 与 `@mobi/shared`，禁止依赖 session / cli / web。

## 关键入口

- `src/index.ts` — hub 进程入口（原 hub 入口，cli `commands/hub.ts` 经 `@mobi/daemon` 动态 import 启动）
- `src/runner/run.ts` — runner 进程入口
- `scripts/generate-embedded-web-assets.ts` — web 静态资产嵌入生成（build:exe 调）

## 测试

双运行器（`test` 脚本串联两者）：

- `tests/hub/` — bun 内置运行器（原 hub 包测试，`--parallel`）
- `tests/runner/` 及其余 — vitest

运行：`bun run test:daemon`（根目录）。

## 编码规范

→ [docs/conventions/](../../docs/conventions/)（hub 侧沿用 docs/conventions/hub.md，14 票文档路径同步）
