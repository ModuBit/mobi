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
    ⚠️ 操作前先读 memory/MEMORY.md（见下「E2E 学习记忆」），避免重新探索

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

## E2E 学习记忆（自优化）

E2E 的具体**操作 recipe 与踩坑记录**存在 `memory/`（随 skill 提交，越用越熟）。`references/e2e.md` 只保留稳定的原则与命令参考；**真正「怎么做」的 know-how 在 memory**，每次 E2E 靠它避免重新探索。这是 skill 自我优化的核心机制——skill 不会自己学习，靠执行者按下面的纪律维护。

### E2E 前：先读（必做）

1. 读 `memory/MEMORY.md` 索引
2. 读本次要做的任务对应的 memory 文件，**照已知 recipe 走**，不要从头探索

### E2E 后：回写（debrief，三种情况才动）

- **新路径**：做了 memory 里没有的任务 → 新建对应文件，记下**能 work 的** recipe，并在 `MEMORY.md` 索引追加一行
- **路径变了**：已知 recipe 失败（选择器 / 按钮 / 端口 / 文案变了）→ 用新发现的能 work 的步骤**覆盖**旧条目
- **绕了弯路**：发现比 memory 里更短的走法 → 替换

三种情况都没发生 → **不动 memory**（不要为了写而写）。

### 维护纪律（防膨胀 / 防腐烂）

- **一主题一文件**，recipe **覆盖式更新**（不追加时间日志，避免膨胀）
- 每个文件 frontmatter 带 `last_verified`，回写时刷新日期；长期未验证的条目 = 可能陈旧，下次用到时优先核实
- **只记做出来的经验**，不臆测；不确定就标注「待验证」
- 新建 / 重命名 / 删除文件后，**同步更新 `memory/MEMORY.md` 索引**（索引是入口，失同步等于丢失）
- memory 与 `references/e2e.md` 职责分开：e2e.md = 稳定原则 / 命令；memory = 演进的 recipe / 坑。**同一 know-how 只存一处**，否则必然陈旧

## 注意事项

- 先执行 run-tests，后执行 /sync-docs（代码正确优先）
- 测试规范详见 docs/conventions/testing.md
- E2E 原则与命令参考详见 references/e2e.md；具体操作 recipe 与踩坑见 memory/（先读 MEMORY.md）

### 测试运行器差异

各包使用不同的测试运行器，**禁止在子目录下直接执行 `bun test`**：

| 包 | 运行器 | 正确命令 |
|---|---|---|
| shared | vitest | `bun run test:shared` |
| hub | bun 内置 | `bun run test:hub` |
| cli | vitest | `bun run test:cli` |
| web | vitest (jsdom) | `bun run test:web` |

web 包的 `bun test` 会调用 bun 内置运行器，完全忽略 `vitest.config.ts` 中的 `environment: 'jsdom'` 和 `setupFiles` 配置，导致所有依赖 DOM API 的测试报 `document is not defined`。始终从根目录执行 `bun run test` 或 `bun run test:web`。
