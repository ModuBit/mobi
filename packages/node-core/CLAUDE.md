# node-core

节点侧共享库：git 簇 / logger / configuration / persistence / utils / webtools 等不依赖会话与 daemon 的本地节点模块（ticket-10 骨架，11 票起搬入）。

依赖方向：只依赖 `@mobi/shared`，禁止依赖 daemon / session / hub / cli / web。

## 编码规范

→ [docs/conventions/](../../docs/conventions/)（随 14 票同步细化）

## 测试

→ [docs/conventions/testing.md](../../docs/conventions/testing.md)

- 框架：vitest
- 运行：`bun run test:node-core`（根目录）
