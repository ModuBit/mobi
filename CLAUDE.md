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

- **修改已有代码前先补测试**: 修改已有组件、函数、模块前，先检查测试覆盖。覆盖不足则先补测试锁定现有行为，测试通过后再改功能。新增代码（新文件、新函数）正常 TDD 流程
- **代码变更后验证**: 必须使用 `/run-tests` skill 执行测试验证（typecheck → 单测 → lint → E2E）
- **端到端测试**: 必须使用 `/run-tests` skill 启动 E2E 环境，禁止手动 `bun run dev` 进行浏览器测试

## 质量门禁

项目通过双层门禁防止 lint warning 回潮：

- **pre-commit**（husky + lint-staged）：提交时对暂存的 `packages/*/src/**/*.{ts,tsx}` 自动跑 `eslint --fix`，自动修复可修 warning（prefer-const、useless-escape、unused-vars 等）。不阻塞含存量 warning 的文件，渐进清理
- **CI**（`.github/workflows/ci.yml`）：push 到 `main` / `fist-milestone` 或 PR 到 `main` 时，并行跑 `typecheck` + `lint`（warning budget）+ `test`
- **lint warning budget**：CI 的 lint job 用 `--max-warnings` 设基线（当前 244 = 版权头合规后的 warning 总数）。新增任意 warning 即 CI 失败；清零一批后将基线下调

## 文档索引

| 需要 | 去哪里 |
|------|--------|
| 系统架构总览 | [docs/architecture/README.md](docs/architecture/README.md) |
| 各模块架构 | [docs/architecture/](docs/architecture/)（hub/ cli/ web/） |
| 编码规范 | [docs/conventions/](docs/conventions/) |
| 调试规范 | [docs/conventions/debugging.md](docs/conventions/debugging.md) |
| 配置指南 | [docs/configuration.md](docs/configuration.md) |
| 待处理项 | [docs/pending.md](docs/pending.md) |

## 文档同步

Stop hook 会在会话结束时自动检测是否有结构性代码变更（新增/删除文件、接口/API/协议修改），有则提醒执行 `/sync-docs`，无变更则完全静默。

收到提醒后，执行 `/sync-docs` 按映射表检查并更新受影响的文档。修 bug、调样式、改注释等不影响结构的变更不会触发提醒。

## Git 规范

- **禁止**在提交信息中包含 `Co-Authored-By` 信息
- **禁止**提交 `.gitignore` 排除的文件：禁止 `git add -f`，禁止 staging 任何被 gitignore 的路径（如 `docs/superpowers/`、`.superpowers/`）。子代理派遣时必须包含此约束，子代理 commit 后必须验证 `git show --stat`
