# Shared 编码规范

适用于 `shared/` 包（TypeScript + Zod）。

## 文件组织

| 文件 | 职责 |
|------|------|
| `src/schemas.ts` | Zod Schema 定义（运行时校验 + 类型推导） |
| `src/types.ts` | 纯 TypeScript 类型重导出（`export type * from './schemas'`） |
| `src/messages.ts` | 消息辅助函数（unwrapRole / isSkippable / isVisible） |
| `src/socket.ts` | Socket.IO 事件类型定义 |
| `src/modes.ts` | 权限模式常量 |
| `src/utils.ts` | 通用工具函数 |
| `src/version.ts` | 协议版本号 |
| `src/index.ts` | Barrel export |

## Schema 编写

### Schema + Type 成对导出

每个 Schema 定义后紧接对应的类型推导：

```typescript
export const SessionSchema = z.object({
    id: z.string(),
    // ...
})
export type Session = z.infer<typeof SessionSchema>
```

- Schema 用 `z.object()` / `z.enum()` 等定义，用于运行时校验
- Type 用 `z.infer<typeof XxxSchema>` 推导，禁止手动重复定义

### 命名约定

- Schema：`XxxSchema`（如 `SessionSchema`、`PermissionModeSchema`）
- Type：去掉 Schema 后缀（如 `Session`、`PermissionMode`）
- 常量：`UPPER_SNAKE_CASE`（如 `PERMISSION_MODES`、`PROTOCOL_VERSION`）

## 导出规则

- `schemas.ts`：`export` Schema 和推导类型（值 + 类型）
- `types.ts`：`export type` 仅重导出类型（不含运行时值），消费方只需类型时引用此文件
- `index.ts`：Barrel export，消费方通过 `@mobi/shared` 统一导入

```typescript
// ✅ 正确：消费方从包入口导入
import { Session, SessionSchema } from '@mobi/shared'

// ❌ 错误：直接引用内部文件
import { Session } from '@mobi/shared/src/schemas'
```

## 变更影响

shared 是所有包的公共依赖，修改后需检查：

- 修改 Schema 字段 → 检查 `hub/src/`、`cli/src/`、`web/src/` 中的消费方
- 新增导出 → 在 `index.ts` 和 `types.ts` 中同步添加
- 删除导出 → 全局搜索确认无引用
