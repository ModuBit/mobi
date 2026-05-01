# groupSessions 缓存归一化设计

## 背景

Web 前端当前有三处缓存存储 Session 完整数据：

| 缓存 | QueryKey | 数据格式 |
|------|----------|----------|
| `sessions` | `['sessions']` | `Session[]` |
| `session(id)` | `['session', id]` | `Session` |
| `groupSessions(gk)` | `['groupSessions', gk]` | 无限查询 `{ pages: [{ sessions: Session[] }] }` |

**问题**：同一份 session 数据在内存中存在多份副本。每次 `session-updated` 心跳（每 2 秒）来临时，`patchSessionCache` 需要同步更新所有副本，其中 `groupSessions` 的更新需要 O(pages × sessions) 的嵌套扫描。

## 目标

让 `sessions` 列表缓存成为 Session 完整数据的**唯一数据源**，`groupSessions` 各查询只存储 `sessionId[]`。

## 方案

### 1. 数据类型变更

`GroupSessionsPage` 从存储完整 Session 对象改为只存 ID：

```typescript
interface GroupSessionsPage {
    sessionIds: string[]       // 替代 sessions: Session[]
    nextCursor: number | null
    hasMore: boolean
}
```

### 2. useGroupSessions 改造

`queryFn` 中拆分数据：收到后端返回的完整 `Session[]` 后，upsert 到 `sessions` 缓存，然后返回 ID 列表。

```typescript
queryFn: async ({ pageParam }) => {
    const res = await api.sessionGroups.getSessions(groupKey!, cursor, PAGE_SIZE)

    // 将完整 Session 数据 upsert 到全局 sessions 缓存
    queryClient.setQueryData<Session[]>(queryKeys.sessions, (old) => {
        const sessionMap = new Map(old?.map(s => [s.id, s]))
        for (const s of res.data.sessions) {
            const existing = sessionMap.get(s.id)
            sessionMap.set(s.id, existing ? { ...existing, ...s } : s)
        }
        return Array.from(sessionMap.values())
    })

    return {
        sessionIds: res.data.sessions.map(s => s.id),
        nextCursor: res.data.nextCursor,
        hasMore: res.data.hasMore,
    }
}
```

### 3. SessionList 改造

SessionList 当前用 `useQueries` 直接调用 API 获取完整 Session 数据。改造后：

- `useQueries` 的 `queryFn` 同样 upsert sessions 到全局缓存，返回 `{ sessionIds, groupKey }`
- 渲染时通过 `useSessions()` 从全局缓存获取完整 Session 数据
- `findSession` 等辅助函数改为从 `useSessions()` 的结果中查找

### 4. SSEProvider 简化

移除 `patchSessionCache` 中 `groupSessions` 的全部更新逻辑（约 45 行）。因为 `groupSessions` 只存 ID，ID 不会因心跳而变化。

```typescript
function patchSessionCache(...) {
    // ... 计算 patch ...

    // 更新单个会话详情缓存
    queryClient.setQueryData<Session>(queryKeys.session(sessionId), (old) => { ... })

    // 更新会话列表缓存（唯一完整数据源）
    queryClient.setQueryData<Session[]>(queryKeys.sessions, (old) => { ... })

    // groupSessions 不再需要更新
}
```

## 边界情况

| 场景 | 处理 |
|------|------|
| groupSessions 已加载但 sessions 列表未加载 | `useSessions()` 返回 undefined，渲染时跳过缺失的 session |
| sessions 缓存中缺少某个 session | `find()` 返回 undefined，该条目不渲染 |
| 同一个 session 出现在多个 group 中 | 各 group 只存 ID，内存中只有一份 Session 对象 |
| 分页加载 groupSessions | 每页数据 upsert 到 sessions 缓存，ID 追加到当前 page |

## 涉及文件

| 文件 | 改动 |
|------|------|
| `web/src/core/data/api/types.ts` | `GroupSessionsPage` 字段变更 |
| `web/src/core/data/hooks/queries/useGroupSessions.ts` | queryFn 中 upsert sessions，返回 ID 列表 |
| `web/src/components/session/SessionList.tsx` | useQueries 返回 ID；渲染时从 `useSessions()` 查找 |
| `web/src/core/providers/SSEProvider.tsx` | 移除 groupSessions 缓存更新逻辑 |
