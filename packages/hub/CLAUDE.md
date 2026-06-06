# hub

核心服务器，连接 CLI 客户端和 Web 前端。

## 编码规范

→ [docs/conventions/hub.md](../../docs/conventions/hub.md)

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

→ [docs/conventions/testing.md](../../docs/conventions/testing.md)

- 框架：bun:test
- 运行：`bun test`
- 使用 `:memory:` SQLite 数据库

## 数据库 Schema 变更策略

使用 `/db-schema` skill 管理 schema 版本，无需手动判断是否需要迁移脚本。

**自动判断规则**（基于 `src/store/index.ts` 中的 `SCHEMA_RELEASE_BASELINE`）：

| 条件 | 含义 | Claude 行为 |
|---|---|---|
| `BASELINE === 0` | 未发布 | 直接修改 `createSchema()` 和相关 SQL，不动 `SCHEMA_VERSION` |
| `BASELINE > 0` | 已发布 | 必须递增 `SCHEMA_VERSION` 并编写 `migrateFromV{N}ToV{N+1}()` 迁移方法 |

**相关命令：**
- `/db-schema` — 查看当前 schema 状态
- `/db-schema release` — 发布时调用，锁定当前版本
- `/db-schema change` — 准备 schema 变更（已发布时自动生成迁移脚手架）

## 架构文档

→ [docs/architecture/hub/](../../docs/architecture/hub/)
