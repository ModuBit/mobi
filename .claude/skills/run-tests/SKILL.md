---
name: run-tests
description: 代码变更完成后，检查并执行测试验证 — typecheck、单测、lint、E2E。当用户要求运行 E2E 测试、验证浏览器流程、测试 Web UI 时，也使用此 skill。
---

# run-tests

代码变更完成后，检查并执行测试验证。

## 触发时机

代码变更完成后，询问用户是否执行测试验证：

- 新增 / 修改了源文件
- 修改了模块接口、导出
- 修复了 bug / 缺陷

改文档、改注释、改配置等不影响逻辑的变更无需询问。

## 执行流程

```
询问用户 → 用户确认执行

第 1 步：typecheck
    bun run typecheck
    ↓ 失败 → 修复后重新执行

第 2 步：单元 & 集成测试
    bun run test
    注意：必须从项目根目录执行，不要 cd 到子目录后单独跑 bun test
    - hub 用 bun 内置运行器，shared/cli/web 用 vitest
    - 在 web 目录下直接 bun test 会忽略 vitest.config.ts 的 jsdom 配置
    ↓ 失败 → 分析失败原因，修复后重新执行

第 3 步：lint 检查
    bun run lint && bun run lint:deps
    ↓ 失败 → 按提示修复

第 4 步：E2E 验证（按需）
    判断是否需要 E2E：不仅限于 UI 变更，任何影响用户通过 Web 使用
    Mobi 的改动（Hub API、协议、Runner 等）都需要 E2E 验证。
    详见 references/e2e.md

输出测试摘要
```

## 输出格式

```
## run-tests 检查结果

- ✅ typecheck — 通过
- ✅ 单测 (shared: 105/105, hub: 129/129, cli: 247/247, web: 456/456) — 全部通过
- ✅ lint — 通过
- ⏭️ E2E — 跳过（本次变更不影响用户使用）
```

## 注意事项

- 先执行 run-tests，后执行 /sync-docs（代码正确优先）
- 测试规范详见 docs/conventions/testing.md
- E2E 验证详见 references/e2e.md（环境启动、Chrome DevTools 操作、验证流程）

### 测试运行器差异

各包使用不同的测试运行器，**禁止在子目录下直接执行 `bun test`**：

| 包 | 运行器 | 正确命令 |
|---|---|---|
| shared | vitest | `bun run test:shared` |
| hub | bun 内置 | `bun run test:hub` |
| cli | vitest | `bun run test:cli` |
| web | vitest (jsdom) | `bun run test:web` |

web 包的 `bun test` 会调用 bun 内置运行器，完全忽略 `vitest.config.ts` 中的 `environment: 'jsdom'` 和 `setupFiles` 配置，导致所有依赖 DOM API 的测试报 `document is not defined`。始终从根目录执行 `bun run test` 或 `bun run test:web`。
