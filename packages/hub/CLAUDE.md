# hub

核心服务器，连接 CLI 客户端和 Web 前端。

## 编码规范

→ [docs/conventions/hub.md](../../docs/conventions/hub.md)

## 关键文件

| 文件 | 职责 |
|------|------|
| `src/index.ts` | 主入口，组件组装 |
| `src/sync/syncEngine.ts` | 同步引擎 |
| `src/sync/snapshotSync.ts` | 流式快照同步（完整基线、版本、订阅游标与连接生命周期） |
| `src/sync/sessionMessageRuntimeProjector.ts` | 持久化消息 → runtimeState 投影（todos/tasks/team/background tasks） |
| `src/sync/sessionMessageFactsProcessor.ts` | CLI 消息事实处理（字段收窄、幂等/单调持久化、领域 publication） |
| `src/store/index.ts` | SQLite 存储层（WAL） |
| `src/store/sessionFork.ts` | 分叉创建领域模块（资格、复制范围、native id 与建行事务） |
| `src/store/projects.ts` | 项目实体存储（「项目实体化」，会话按项目 / 「最近」组织） |
| `src/web/routes/projects.ts` | 项目 Web API（/api/projects） |
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
