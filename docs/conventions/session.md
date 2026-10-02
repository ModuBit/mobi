# session 编码规范

适用于 `session/` 包（会话宿主：与 Claude Code 会话进程共处的一切）。

## 模块结构

与 daemon 相同：每模块一目录、入口 `index.ts`、构造函数/工厂参数注入依赖（见 [daemon.md](daemon.md)）。`claude/utils/` 单文件工具按「一个关注点一文件」组织，不设桶文件。

## 依赖方向

只依赖 `@mobi/node-core` 与 `@mobi/shared`；禁止依赖 daemon / cli / web（daemon ⟂ session，交互只经 shared 协议与 node-core 文件契约）。

## 相对路径纪律

session `src/` 内部 import 一律相对路径（`@/` 会被消费方 tsc 的 paths 劫持，同 node-core）；`tests/` 可用 `@/`（vitest alias），且 tests 不入 tsc program（tsconfig 只 include src）。

## 测试

vitest：`bun run test:session`（根目录）。
