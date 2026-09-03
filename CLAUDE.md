# CLAUDE.md

Mobi — Claude Code 远程控制工具，通过浏览器远程与本地 Claude Code 会话交互。

## Monorepo

| 包 | 职责 |
|---|---|
| [shared/](packages/shared/) | 协议定义（Zod Schema） |
| [hub/](packages/hub/) | 服务器（Hono + Socket.IO + SQLite） |
| [cli/](packages/cli/) | 客户端（Bun + Ink + Claude Agent SDK） |
| [web/](packages/web/) | 前端（React + Ant Design X + TanStack） |

各包目录下有 `CLAUDE.md`，进入对应目录时自动加载。

## 全局约束

- **先看事实再推理**: 分析问题前先看代码和日志，禁止凭想象构造前提再推理。不确定就说不确定，不要编造"分析"
- **架构优先**: 接手任务时先查阅 `docs/architecture/` 中相关模块的架构文档，再深入代码细节
- **改前先定位根因**: 修复问题先找到根本原因，禁止为绕过表象草草打补丁、往条件里堆逻辑。站在更大视野设计改动，兼顾鲁棒性、可读性、可扩展性——先想清楚概念该由谁承载、放在哪一层，再动手。判断散落成内联条件时抽成命名良好、带文档的函数，让"为什么"集中在一处而非分散复制
- **运行时**: bun（不是 npm/node）
- **TypeScript**: 严格模式
- **注释**: 中文
- **内部依赖**: `workspace:*`

## 新建文件

创建 `.ts` / `.tsx` 文件前，先读 [docs/conventions/license-header.md](docs/conventions/license-header.md) 获取版权头模板。

编码规范按包查阅：
- Shared → [docs/conventions/shared.md](docs/conventions/shared.md)
- Hub → [docs/conventions/hub.md](docs/conventions/hub.md)
- CLI → [docs/conventions/cli.md](docs/conventions/cli.md)
- Web → [docs/conventions/web.md](docs/conventions/web.md)

## 快速命令

```bash
bun install          # 安装依赖
bun run dev          # 启动 Hub + Web
bun run build        # 构建
bun run typecheck    # 类型检查
bun run test         # 测试
bun run lint         # ESLint 检查
bun run lint:deps    # 依赖方向检查
```

## 测试

- **修改已有代码前先读测试**: 改前先读对应测试了解现有行为约定（必读），但不强制补齐覆盖。按变更类型定补测试规则：修 bug 必须先有复现测试（红→绿）；改行为必须更新对应测试；新增核心路径逻辑 TDD，边缘路径自行判断；纯机械改动（透传、样式、文案、import）可跳过，仅在锁外部契约时补。测试断言对象用「换实现方式后是否仍应成立」检验——断言实现细节的测试会阻碍重构，改到时顺手删或简化。新增代码（新文件、新函数）正常 TDD 流程
- **代码变更后验证**: 必须使用 `/run-tests` skill 执行测试验证（typecheck → 单测 → lint → E2E）
- **端到端测试**: 必须使用 `/run-tests` skill 启动 E2E 环境，禁止手动 `bun run dev` 进行浏览器测试

## 质量门禁

项目通过双层门禁防止 lint warning 回潮：

- **pre-commit**（husky + lint-staged）：提交时对暂存的 `packages/*/src/**/*.{ts,tsx}` 自动跑 `eslint --fix`，自动修复可修 warning（prefer-const、useless-escape、unused-vars 等）。不阻塞含存量 warning 的文件，渐进清理
- **CI**（`.github/workflows/ci.yml`）：push 到 `main` / `fist-milestone` 或 PR 到 `main` 时，并行跑 `typecheck` + `lint`（warning budget）+ `test`
- **lint warning budget**：CI 的 lint job 用 `--max-warnings` 设基线（当前 0 = P2 收窄后代码层面 any 清零：any 97 全收窄 + no-control-regex 4 抑制）。零容忍——新增任意 warning 即 CI 失败

## 文档索引

| 需要 | 去哪里 |
|------|--------|
| 系统架构总览 | [docs/architecture/README.md](docs/architecture/README.md) |
| 各模块架构 | [docs/architecture/](docs/architecture/)（hub/ cli/ web/） |
| 编码规范 | [docs/conventions/](docs/conventions/) |
| 调试规范 | [docs/conventions/debugging.md](docs/conventions/debugging.md) |
| 配置指南 | [docs/configuration.md](docs/configuration.md) |
| Claude / Agent SDK 文档 | [docs/claude-agent-sdk/README.md](docs/claude-agent-sdk/README.md)（链接索引，每次拿最新） |
| 待处理项 | [docs/pending.md](docs/pending.md) |

## 文档同步

Stop hook 会在会话结束时自动检测是否有结构性代码变更（新增/删除文件、接口/API/协议修改），有则提醒执行 `/sync-docs`，无变更则完全静默。

收到提醒后，执行 `/sync-docs` 按映射表检查并更新受影响的文档。修 bug、调样式、改注释等不影响结构的变更不会触发提醒。

## Git 规范

- **禁止**在提交信息中包含 `Co-Authored-By` 信息
- **禁止**提交 `.gitignore` 排除的文件：禁止 `git add -f`，禁止 staging 任何被 gitignore 的路径（如 `docs/superpowers/`、`.superpowers/`）。子代理派遣时必须包含此约束，子代理 commit 后必须验证 `git show --stat`

## Agent skills

### Issue tracker

Issues 以本地 markdown 形式追踪：高层 backlog 在 `docs/pending.md`，特性级 spec/ticket 在 `.scratch/<feature-slug>/`。详见 `docs/agents/issue-tracker.md`。

### Triage labels

使用五个标准 triage 标签（needs-triage / needs-info / ready-for-agent / ready-for-human / wontfix）。详见 `docs/agents/triage-labels.md`。

### Domain docs

multi-context 布局：根 `CONTEXT-MAP.md` 指向各包的 `CONTEXT.md`。详见 `docs/agents/domain.md`。
