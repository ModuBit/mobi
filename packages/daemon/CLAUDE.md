# daemon

单机 daemon：hub 服务与 runner（machine 宿主 / controlServer / handlers 等），hub+runner 合并的落点（ticket-10 骨架，12 票起搬入）。

依赖方向：只依赖 `@mobi/node-core` 与 `@mobi/shared`，禁止依赖 session / hub / cli / web。

## 测试

双运行器（`test` 脚本串联两者）：

- `tests/hub/` — bun 内置运行器（12 票从 hub 包搬入）
- 其余 `tests/` — vitest

运行：`bun run test:daemon`（根目录）。

## 编码规范

→ [docs/conventions/](../../docs/conventions/)（随 14 票同步细化）
