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

## 看板

- 使用 `/board` skill 管理项目事项
- 完成功能开发后，询问用户是否更新看板状态
- 接手新任务前，读取看板了解当前进度

## 文档索引

| 需要 | 去哪里 |
|------|--------|
| 系统架构总览 | [docs/architecture/README.md](docs/architecture/README.md) |
| 各模块架构 | [docs/architecture/](docs/architecture/)（hub/ cli/ web/） |
| 编码规范 | [docs/conventions/](docs/conventions/) |
| 配置指南 | [docs/configuration.md](docs/configuration.md) |
| 项目看板 | [docs/board/board.md](docs/board/board.md)（`/board` skill） |
| 待处理项 | [docs/pending.md](docs/pending.md) |

## 文档同步

代码变更涉及以下情况时，询问用户是否执行 `/sync-docs` 检查并更新受影响的项目文档：

- 新增 / 删除 / 重命名了源文件或目录
- 修改了模块接口、导出、API 端点
- 修改了通信协议、数据流、消息格式

修 bug、调样式、改注释等不影响结构的变更无需询问。

## Git 规范

- **禁止**在提交信息中包含 `Co-Authored-By` 信息
