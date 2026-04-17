# 测试规范

Mobi 各包的测试策略、运行命令和覆盖率目标。

## 测试框架

| 包 | 框架 | 配置文件 |
|---|---|---|
| shared | vitest | `shared/vitest.config.ts` |
| hub | bun:test | `hub/tsconfig.json`（内置配置） |
| cli | vitest | `cli/vitest.config.ts` |
| web | vitest | `web/vitest.config.ts` |

## 目录约定

- 测试文件放在 `{module}/tests/` 目录下，与 `src/` 平级
- 命名规则：`*.test.ts` / `*.test.tsx`
- 测试辅助工具放在 `{module}/tests/helpers/` 下

```
shared/
  src/
  tests/
    schemas.test.ts
    messages.test.ts
    helpers/
hub/
  src/
  tests/
    syncEngine.test.ts
    store.test.ts
    helpers/
```

## 运行命令

| 命令 | 说明 |
|---|---|
| `bun run test` | 运行所有包的测试 |
| `bun run typecheck` | 类型检查 |
| `bun run lint` | ESLint 检查 |
| `bun run lint:deps` | 依赖方向检查（dependency-cruiser） |

单独运行某个包的测试：

```bash
cd shared && bun test     # vitest
cd hub   && bun test      # bun:test
cd cli   && bun test      # vitest
cd web   && bun test      # vitest
```

## Mock 策略

### 原则

- **优先 mock 外部依赖**（SDK、网络请求、文件系统），不 mock 内部模块
- mock 内部模块仅当该模块有副作用（如数据库写入、网络连接）时

### 各包 Mock 策略

| 包 | Mock 方式 |
|---|---|
| shared | 通常不需要 mock（纯 Schema/类型） |
| hub | 使用 `:memory:` SQLite 数据库；mock Socket.IO 广播 |
| cli | mock Claude Agent SDK、网络请求 |
| web | `@testing-library/react` + jsdom；mock SSE 连接、API 请求 |

### 示例

**hub — 内存数据库**

```typescript
// tests/helpers/db.ts
import { Database } from 'bun:sqlite';

export function createTestDb() {
  const db = new Database(':memory:');
  db.exec('PRAGMA journal_mode = WAL');
  // 初始化表结构...
  return db;
}
```

**web — 组件测试**

```typescript
// tests/Component.test.tsx
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      {ui}
    </QueryClientProvider>,
  );
}
```

## 覆盖率目标

| 包 | 目标 | 说明 |
|---|---|---|
| shared | 80%+ | 协议定义是跨包基础，需高覆盖 |
| hub | 60%+ | 服务器逻辑，核心路径覆盖 |
| cli | 50%+ | CLI 交互较多，重点覆盖核心逻辑 |
| web | 50%+ | 组件测试，重点覆盖交互逻辑 |

## E2E 测试

### 工具

使用 Chrome DevTools MCP 进行端到端验证。

### 执行方式

E2E 测试通过 `run-tests` Skill 触发，Skill 内含环境启动、清理和验证的完整流程。
