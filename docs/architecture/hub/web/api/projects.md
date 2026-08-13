# Projects API

**文件**：
- [`packages/hub/src/web/routes/projects.ts`](/packages/hub/src/web/routes/projects.ts)

项目实体（「项目实体化」）相关的 HTTP API。项目 = 一台机器上的一组源文件夹（folders，primary 即 Claude Code 的 cwd），会话通过 `projectId` 归属项目，未归属的会话进入「最近」。

## 路由总览 (`/api/projects`)

| 方法 | 路径 | 功能 | 要求 |
|------|------|------|------|
| GET | `/projects` | 项目列表 | 支持 `?machineId=` 过滤 |
| POST | `/projects` | 创建项目 | - |
| GET | `/projects/:id` | 获取项目详情 | - |
| PATCH | `/projects/:id` | 改名 / 改 folders（machineId 不可改） | - |
| DELETE | `/projects/:id` | 删除项目（名下会话解绑进「最近」） | - |
| GET | `/projects/:id/sessions` | 项目内会话分页 | - |
| GET | `/projects/sessions/unbound` | 「最近」区会话分页（未归属项目的会话） | - |

> 注意：`/projects/sessions/unbound` 必须注册在 `/projects/:id` 与 `/projects/:id/sessions` 之前，否则两段路径 `sessions/unbound` 会被参数路由按 `:id=sessions` 拦截（同类坑见 cli.ts）。

## 实体

### Project

```typescript
interface Project {
    id: string          // UUID
    namespace: string   // 命名空间
    machineId: string   // 归属机器（folders 是机器本地路径，跨机器不可用）
    name: string
    folders: Array<{ path: string, primary: boolean }>
    createdAt: number
    updatedAt: number
    seq: number         // 乐观锁版本号
}
```

### folders 校验

`validateProjectFolders()`（shared）把守所有写入路径：

- 至少 1 项
- 恰好 1 项 `primary`（即 Claude Code 的 cwd）

## 端点详情

### GET /projects — 项目列表

```
GET /api/projects                        // 全部
GET /api/projects?machineId=mach-123     // 按机器过滤
```

```json
// Response
{ "projects": [ { "id": "proj-1", "name": "mobi", "machineId": "mach-123", "folders": [...] } ] }
```

### POST /projects — 创建项目

```json
// Request
{ "name": "mobi", "machineId": "mach-123", "folders": [{ "path": "/Users/dev/mobi", "primary": true }] }

// Response
{ "project": { ... } }

// Error
{ "error": "At least one folder is required" }       // 400（folders 校验）
{ "error": "Exactly one primary folder is required" } // 400
```

### PATCH /projects/:id — 改名 / 改 folders

```json
// Request（字段均可选）
{ "name": "新名称", "folders": [...] }

// Response
{ "project": { ... } }
```

### DELETE /projects/:id — 删除项目

删除事务内将名下会话解绑（`project_id` 置 NULL，会话本身不删），删除成功后由 ProjectCache 逐个广播 `session-updated`，让 Web 感知会话流入「最近」。

```json
// Response
{ "success": true }
```

### GET /projects/:id/sessions — 项目内会话分页

```
GET /api/projects/proj-1/sessions?limit=20&cursor=1712000060000
```

游标为 `updated_at`（降序），`limit` 默认 20、上限 100。

```json
// Response
{
    "sessions": [ /* SessionSummary[]（active/running 来自实时缓存） */ ],
    "nextCursor": 1711990000000,
    "hasMore": true,
    "total": 3
}
```

### GET /projects/sessions/unbound — 「最近」区会话分页

查询 `project_id IS NULL` 的会话，query 参数与响应结构与 `/projects/:id/sessions` 一致。

## SSE 联动

项目 CRUD 由 ProjectCache（`packages/hub/src/sync/projectCache.ts`）广播事件：

| 事件 | 触发 |
|------|------|
| `project-added` | 创建成功 |
| `project-updated` | 改名 / 改 folders 成功 |
| `project-removed` | 删除成功（随后逐个广播名下会话的 `session-updated`） |

project 事件必须带 `namespace`——EventPublisher 的 `resolveNamespace` 不认 `projectId`、无缓存回查，shared schema 强制必填。

## 与其他端点的关系

| 端点 | 项目语义 |
|------|----------|
| `POST /cli/sessions` | 请求可带 `projectId`（校验同 namespace 现存项目 + 机器归属），响应附带 `project` 实体 |
| `POST /api/machines/:id/spawn` | spawn 可带 `projectId`（项目须归属目标机器） |
| `PATCH /api/sessions/:id` | `projectId` 字段归入 / 移出项目，见 [Sessions API](./sessions.md) |
