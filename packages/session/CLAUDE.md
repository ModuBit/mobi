# session

会话侧：claude 会话循环 / agent / modules / api 客户端等驱动单个 Claude Code 会话的模块（ticket-10 骨架，13 票起搬入）。

依赖方向：只依赖 `@mobi/node-core` 与 `@mobi/shared`，禁止依赖 daemon / hub / cli / web。

## 编码规范

→ [docs/conventions/](../../docs/conventions/)（随 14 票同步细化）

## 测试

→ [docs/conventions/testing.md](../../docs/conventions/testing.md)

- 框架：vitest
- 运行：`bun run test:session`（根目录）
