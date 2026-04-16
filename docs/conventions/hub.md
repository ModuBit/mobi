# Hub 编码规范

适用于 `hub/` 包（Bun + Hono + Socket.IO + SQLite）。

## 模块结构

每个模块一个目录，入口为 `index.ts`：

```
hub/src/
├── sync/
│   ├── index.ts          # 导出 SyncEngine
│   ├── syncEngine.ts     # 核心实现
│   ├── eventPublisher.ts # 子功能
│   └── ...
├── store/
│   ├── index.ts          # 导出 Store（聚合）
│   ├── sessionStore.ts   # 领域存储
│   ├── messageStore.ts
│   └── ...
```

## 依赖注入

模块间通过**构造函数/工厂参数**注入依赖，不使用全局导入：

```typescript
// ✅ 正确：工厂函数接收依赖
export function createSessionsRoutes(getSyncEngine: () => SyncEngine): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()
    app.get('/sessions', (c) => {
        const engine = getSyncEngine()
        // ...
    })
    return app
}

// ❌ 错误：直接导入全局实例
import { syncEngine } from '../sync/syncEngine'
```

主入口 `index.ts` 负责组装所有依赖并注入。

## HTTP 路由（Hono）

### 路由组织

每个资源域一个路由文件，使用工厂函数模式：

```typescript
// routes/sessions.ts
export function createSessionsRoutes(getSyncEngine: () => SyncEngine): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.get('/sessions', (c) => { ... })
    app.post('/sessions/:id/abort', async (c) => { ... })

    return app
}
```

在 `server.ts` 中挂载：

```typescript
app.route('/api', createSessionsRoutes(getSyncEngine))
```

### 请求校验

使用 **Zod** 定义请求体 schema，定义在路由文件顶部：

```typescript
const renameSessionSchema = z.object({
    name: z.string().min(1).max(255)
})

app.patch('/sessions/:id', async (c) => {
    const body = await c.req.json()
    const parsed = renameSessionSchema.safeParse(body)
    if (!parsed.success) {
        return c.json({ error: 'Invalid request' }, 400)
    }
    // ...
})
```

### 守卫函数

使用守卫函数进行前置检查，返回 `Response` 时提前终止：

```typescript
const engine = requireSyncEngine(c, getSyncEngine)
if (engine instanceof Response) return engine  // 守卫失败，返回错误响应
```

## 数据库（SQLite）

### 存储层组织

按领域拆分 Store（`SessionStore`、`MessageStore`、`MachineStore` 等），由 `Store` 聚合：

```typescript
export class Store {
    readonly sessions: SessionStore
    readonly messages: MessageStore
    // ...
}
```

### 查询模式

使用 `bun:sqlite` 的 `prepare` + `get`/`run`：

```typescript
const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id)
db.prepare('INSERT INTO sessions (...) VALUES (...)').run({ ... })
```

- 模式版本号：`SCHEMA_VERSION` 常量管理
- WAL 模式：数据库使用 WAL journal mode
- 测试使用 `:memory:` 数据库

## Socket.IO

- **命名空间**：`/cli`（CLI 连接）、`/web`（Web 连接）
- **类型安全**：使用 `ServerToClientEvents` / `ClientToServerEvents` 接口
- **事件处理**：按功能域组织 handler

## 测试

- 测试框架：`bun:test`（`describe`、`test`、`expect`）
- 测试目录：`hub/tests/`（与源码分离）
- 数据库：测试使用 `:memory:` SQLite
- 测试运行：`bun run test`（根目录）
