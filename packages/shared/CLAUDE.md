# shared

协议定义包，使用 Zod Schema 定义跨包共享的类型和协议。

## 编码规范

→ [docs/conventions/shared.md](../../docs/conventions/shared.md)

## 关键文件

| 文件 | 职责 |
|------|------|
| `src/schemas.ts` | Schema 定义（Session, AgentState, SyncEvent 等） |
| `src/types.ts` | 纯 TypeScript 类型重导出 |
| `src/messages.ts` | 消息辅助函数（unwrapRole / isSkippable / isVisible） |
| `src/socket.ts` | Socket.IO 事件类型定义 |
| `src/index.ts` | Barrel export |

## 测试

→ [docs/conventions/testing.md](../../docs/conventions/testing.md)

- 框架：vitest
- 运行：`bun test`

## 约束

- 所有跨包共享的类型必须在此包定义
- 使用 Zod 进行运行时校验
- 修改 Schema 后，检查所有消费方（hub、cli、web）是否需要同步更新
