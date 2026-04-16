# hub

核心服务器，连接 CLI 客户端和 Web 前端。

## 编码规范

→ [docs/conventions/hub.md](../docs/conventions/hub.md)

## 关键文件

| 文件 | 职责 |
|------|------|
| `src/index.ts` | 主入口，组件组装 |
| `src/sync/syncEngine.ts` | 同步引擎 |
| `src/store/index.ts` | SQLite 存储层（WAL） |
| `src/socket/server.ts` | Socket.IO 服务器 |
| `src/web/server.ts` | HTTP 服务器 |
| `src/sse/sseManager.ts` | SSE 管理器 |

## 配置

- 数据目录: `~/.mobi/`
- 默认端口: 2222
- 数据库: SQLite (WAL)

## 测试

→ [docs/conventions/testing.md](../docs/conventions/testing.md)

- 框架：bun:test
- 运行：`bun test`
- 使用 `:memory:` SQLite 数据库

## 架构文档

→ [docs/architecture/hub/](../docs/architecture/hub/)
