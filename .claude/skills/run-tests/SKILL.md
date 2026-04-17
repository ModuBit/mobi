---
name: run-tests
description: 代码变更完成后，检查并执行测试验证 — typecheck、单测、lint、E2E
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
    ↓ 失败 → 分析失败原因，修复后重新执行

第 3 步：lint 检查
    bun run lint && bun run lint:deps
    ↓ 失败 → 按提示修复

第 4 步：E2E 验证（按需）
    根据变更影响范围判断是否需要 E2E：
    - 仅 Web UI 变更 → 启动 E2E 环境验证
    - 仅后端变更 → 跳过
    - 全栈变更 → 启动 E2E 环境验证

    启动：bash scripts/e2e-bootstrap.sh（前台运行，Ctrl+C 或 SIGTERM 触发自动清理）
    清理：bash scripts/e2e-cleanup.sh（单独清理进程、数据目录、日志）
    验证：使用 Chrome DevTools MCP 工具操作浏览器

输出测试摘要
```

## 输出格式

```
## run-tests 检查结果

- ✅ typecheck — 通过
- ✅ 单测 (shared: 60/60, hub: 19/19, cli: 147/147, web: 127/127) — 全部通过
- ✅ lint — 通过
- ⏭️ E2E — 跳过（本次变更不涉及 Web UI）
```

## 注意事项

- 先执行 run-tests，后执行 /sync-docs（代码正确优先）
- E2E 脚本位于 skill 目录的 `scripts/` 下，与 SKILL.md 共同维护
- 测试规范详见 docs/conventions/testing.md
