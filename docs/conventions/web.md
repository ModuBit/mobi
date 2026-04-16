# Web 编码规范

适用于 `web/` 包（React 19 + Ant Design X + TanStack）。

## 组件

- **导出方式**：`export function` 或 `export default function` 均可
- **文件命名**：PascalCase（如 `ChatContainer.tsx`、`ToolCard.tsx`）
- **组件定义**：函数组件 + Hooks，不使用 class 组件
- **Props 类型**：在同一个文件内定义 `interface ComponentNameProps`

```typescript
// 两种风格都可以
export function ChatContainer({ sessionId }: ChatContainerProps) { ... }
export default function TerminalView({ sessionId }: TerminalViewProps) { ... }
```

## Hooks

### 查询（queries/）

每个查询一个文件，使用 `useQuery` + `queryKeys`：

```typescript
export function useSessions() {
    const { token } = useAuthStore()
    const api = useMobiApi(token)

    return useQuery({
        queryKey: queryKeys.sessions,
        queryFn: () => api.sessions.list(),
        enabled: !!token,
    })
}
```

### 变更（mutations/）

变更成功后通过 `queryClient.invalidateQueries` 刷新缓存：

```typescript
export function useSendMessage(sessionId: string) {
    const queryClient = useQueryClient()
    // ...
    return useMutation({
        mutationFn: (text: string) => api.messages.send(sessionId, text),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: queryKeys.messages(sessionId) })
        },
    })
}
```

### 缓存 Key

所有 queryKey 必须在 `src/lib/query-keys.ts` 中集中定义，禁止硬编码：

```typescript
// ✅ 正确
queryKey: queryKeys.messages(sessionId)

// ❌ 错误
queryKey: ['messages', sessionId]
```

## 状态管理

| 状态类型 | 方案 | 示例 |
|----------|------|------|
| 服务端状态 | TanStack Query | 会话、消息、机器列表 |
| 客户端 UI 状态 | Zustand | 主题、语言、侧边栏 |
| 认证状态 | Zustand + localStorage | JWT token |
| URL 状态 | TanStack Router | 当前会话 ID |

**禁止**将服务端状态存入 Zustand。SSE 事件直接更新 Query 缓存。

### Zustand Store 模式

```typescript
export const useUiStore = create<UiState>()(
    persist(
        (set) => ({
            // 状态
            theme: 'dark' as Theme,
            // 操作
            setTheme: (theme) => set({ theme }),
        }),
        {
            name: 'mobi-ui',
            partialize: (state) => ({ theme: state.theme }), // 选择性持久化
        }
    )
)
```

## API 层

- **类型定义**：所有类型集中在 `src/api/types.ts`，不在组件中重复定义
- **API 客户端**：通过 `useMobiApi(token)` 获取实例，不在组件外创建
- **错误处理**：401 由全局 handler 自动处理，组件只需处理业务错误

## 路径别名

使用 `@/` 映射到 `src/`：

```typescript
import { useAuthStore } from '@/stores/authStore'
import { queryKeys } from '@/lib/query-keys'
```

## 测试

- 测试框架：Vitest
- 测试目录：`web/tests/`（与源码分离）
- 测试运行：`bun run test`（根目录）

## 国际化

- 使用 i18next，翻译文件在 `src/i18n/locales/`（`en.json`、`zh.json`）
- UI 中使用 `t('key')` 而非硬编码文本
