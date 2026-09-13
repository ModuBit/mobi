# Hub 编码规范

适用于 `hub/` 包（Bun + Hono + Socket.IO + SQLite）。

## 模块结构

每个模块一个目录，入口为 `index.ts`：

```
packages/hub/src/
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
- **「事实」类上报（CLI 持续上报状态/事件）走统一前置**：`validateAndForward`（schema 表 → 鉴权 → sink 分发）。新增一种事实 = schema 表加一项 + `SessionFactsSink` 加一个方法 + 一行转发，不再复制样板（见 `sync/sessionFacts.ts`）
- **「此刻」的事实不落库、不广播**：随进程生灭且会反复翻转的状态（如「会话此刻能不能收消息」）只放进程内 latch，不进 Session 实体——落库/广播既刷屏、又会让「没定论」冒充「确定结论」。这类事实的正当用途只有两个：**等它成立**与**把失败说准**；**别当闸门**（翻转窗口会把正常对象挡在门外）
- **失败文案的单一翻译点**：上游/RPC 错误由领域模块译成能独立读懂的人话（agent 不该看到 `RPC handler not registered` 这类内部结构）；成功文案反过来——Hub 只报事实，措辞由 CLI 工具按事实拼
- **失败分类由产生它的那一层带上，消费方不读文案**：跨层要判「故障的性质」时用结构化分类（`RpcFailure`，见 `sync/rpcFailure.ts`），别在领域层 `message.includes(...)` 反解——适配器或另一个进程改一个字，分类就静默降级。只在**别处产出的散文**上才允许匹配，且判据只留一处（适配器内）

## 测试

- 测试框架：`bun:test`（`describe`、`test`、`expect`）
- 测试目录：`packages/hub/tests/`（与源码分离）
- 数据库：测试使用 `:memory:` SQLite
- 测试运行：`bun run test`（根目录）
