# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Mobi 是 Claude Code 远程控制工具，允许用户通过浏览器远程与本地 Claude Code 会话交互。

Monorepo 结构: `shared/` (协议) + `hub/` (服务器) + `cli/` (客户端) + `web/` (前端)

详细文档: [architecture.md](docs/architecture.md) | [development.md](docs/development.md) | [web-architecture.md](docs/web-architecture.md)

## Constraints

- **运行时**: 使用 bun（不是 npm/node）
- **注释语言**: 代码中使用中文注释
- **内部依赖**: 使用 `workspace:*` 引用
- **TypeScript**: 严格模式
- **文档同步**: 修改了架构、新增包、调整关键文件路径、改变通信机制后，同步更新 `docs/architecture.md`；调整了脚本命令、CLI 子命令、环境变量后，同步更新 `docs/development.md`

## Quick Commands

```bash
bun install          # 安装依赖
bun run dev          # 启动 Hub + Web
bun run build        # 构建
bun run typecheck    # 类型检查
bun run test         # 测试
```

## Key Files

| 组件 | 路径 |
|------|------|
| 同步引擎 | `hub/src/sync/syncEngine.ts` |
| 存储层 | `hub/src/store/index.ts` |
| 会话循环 | `cli/src/claude/loop.ts` |
| Schema 定义 | `shared/src/schemas.ts` |
| 主布局 | `web/src/components/layout/MainLayout.tsx` |
| 图标导航 | `web/src/components/layout/RailNav.tsx` |
| 会话模块 | `web/src/components/session/SessionModule.tsx` |
| UI 状态 | `web/src/stores/uiStore.ts` |
| 路由配置 | `web/src/router.tsx` |

## Config

- 数据目录: `~/.mobi/`
- 默认端口: 2222
- 数据库: SQLite (WAL)

## License Header

所有源代码文件（`.ts`、`.tsx`）必须包含 Apache 2.0 版权信息。创建新文件时，请在文件开头添加：

```typescript
/*
 * Copyright Maner·Fan
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
```

适用范围：`shared/src/`、`hub/src/`、`cli/src/`、`web/src/` 及项目配置文件
