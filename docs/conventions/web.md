# Web 编码规范

适用于 `web/` 包（React 19 + Ant Design X + TanStack）。

## 目录结构

```
src/
├── core/                    ← 基础设施
│   ├── data/                ← 数据层
│   │   ├── api/             ← API 客户端与类型
│   │   ├── stores/          ← Zustand 全局状态
│   │   ├── realtime/        ← SSE 客户端
│   │   └── hooks/           ← TanStack Query 封装（queries/ + mutations/）
│   ├── config/              ← 应用配置
│   │   ├── i18n/            ← 国际化
│   │   └── theme/           ← 主题系统
│   ├── lib/                 ← 业务辅助逻辑
│   ├── utils/               ← 纯工具函数
│   └── providers/           ← React Context Provider
├── domain/                  ← 领域逻辑（纯数据，不依赖 React）
│   ├── chat/                ← 聊天（消息解析、reducer、工具合并）
│   ├── command/             ← 命令（斜杠命令处理）
│   ├── session/             ← 会话（类型定义、用户偏好）
│   └── tool/                ← 工具（输入解析、类型定义）
├── components/              ← UI 组件
├── pages/                   ← 页面路由
├── App.tsx
├── main.tsx
└── router.tsx
```

### 领域逻辑 vs UI 组件的边界

- **`domain/`** 放纯数据处理和业务规则，不依赖 React（无 hooks、无 JSX）
- **`components/`** 放 UI 渲染和 React hooks
- 新增领域逻辑时，如果文件不导入 React，应放入 `domain/` 对应子目录

## 组件

### 单一职责

**一个文件只做一件事。** 不允许在容器组件中内联定义多个子组件或工具函数。

反例（禁止）：
```typescript
// ❌ ChatContainer.tsx 内联了 6 个子组件 + 6 个工具函数
function ChatContainer() {
    // ...
}
function CliOutputBlock() { ... }
function ToolCallRenderer() { ... }
function parseCliOutputText() { ... }
function formatMessageTime() { ... }
```

正例（拆分）：
```typescript
// ✅ ChatContainer.tsx 只做编排
import { renderChatBlock } from './blocks'
import { hasBashTags } from '@/domain/chat'
import { formatMessageTime } from '@/core/utils/timeFormat'

function ChatContainer() { ... }

// ✅ blocks/CliOutputBlock.tsx
export const CliOutputBlock = memo(function CliOutputBlock() { ... })

// ✅ domain/chat/cliParser.ts
export function parseCliOutputText(text: string) { ... }
```

### 分层规则

组件中的逻辑按职责下沉到对应层级，**禁止在组件文件中保留应属于 domain 或 utils 的纯函数**：

| 职责 | 归属 | 示例 |
|------|------|------|
| 纯数据解析、格式化（无 React 依赖） | `domain/` | `parseCliOutputText`、`detectMentionAtCursor`、`buildMentionPath` |
| 通用工具函数 | `core/utils/` | `formatMessageTime`、`path.ts` |
| UI 渲染、React hooks | `components/` | `CliOutputBlock`、`ToolCallRenderer` |
| 数据获取、状态管理 | `core/data/` | `useMessages`、`useAuthStore` |

### 容器组件模式

容器组件（如 `ChatContainer`、`ChatComposer`）只负责三件事：
1. **数据获取** — 调用 hooks 获取数据
2. **编排调度** — 将数据转换为子组件可用的 props
3. **事件处理** — 转发用户操作

具体的渲染逻辑、解析逻辑、格式化逻辑一律下沉到对应层级。

### 交互组件拆分

容器组件中内联的交互子组件（下拉面板、弹窗、卡片等）必须抽为独立文件，与容器同目录：

```
components/composer/
├── ChatComposer.tsx          ← 编排层（状态管理 + 键盘导航 + 布局）
├── MentionDropdown.tsx       ← @ 文件引用下拉
├── SlashCommandDropdown.tsx  ← 斜杠命令下拉
└── ...
```

判断标准：如果一段 JSX 满足以下任一条件，就应拆出：
- 有自己的 Props 接口
- 包含独立的列表渲染逻辑（map + 样式 + 事件）
- 可能在其他地方复用

### 模块内 blocks 模式

当一个模块需要渲染多种类型的块/卡片时，使用 `blocks/` 子目录组织：

```
components/chat/
├── ChatContainer.tsx      ← 编排层
├── blocks/                ← 各类型渲染器
│   ├── index.tsx          ← renderChatBlock 调度器
│   ├── TextBlock.tsx
│   ├── CliOutputBlock.tsx
│   └── ...
└── ...其他子组件
```

新增类型时只需：在 `blocks/` 下加一个文件 → 在 `index.tsx` 的 switch 中加一行。

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

所有 queryKey 必须在 `src/core/lib/query-keys.ts` 中集中定义，禁止硬编码：

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

- **类型定义**：所有类型集中在 `src/core/data/api/types.ts`，不在组件中重复定义
- **API 客户端**：通过 `useMobiApi(token)` 获取实例，不在组件外创建
- **错误处理**：401 由全局 handler 自动处理，组件只需处理业务错误

## 路径别名

使用 `@/` 映射到 `src/`：

```typescript
import { useAuthStore } from '@/core/data/stores/authStore'
import { queryKeys } from '@/core/lib/query-keys'
```

## 测试

- 测试框架：Vitest
- 测试目录：`packages/web/tests/`（与源码分离）
- 测试运行：`bun run test`（根目录）

## 国际化

- 使用 i18next，翻译文件在 `src/core/config/i18n/locales/`（`en.json`、`zh.json`）
- UI 中使用 `t('key')` 而非硬编码文本
- **key 路径必须包含完整的命名空间前缀**：i18n 资源按页面/模块嵌套，key 必须从顶层开始。例如 `chat` 下的工具翻译 key 是 `chat.tool.xxx`，不是 `tool.xxx`

```typescript
// ✅ 正确 — 包含完整路径
t('chat.tool.submit')
t('chat.tool.other')
t('chat.tool.askUserQuestion.title')

// ❌ 错误 — 缺少命名空间前缀，会显示字面量
t('tool.submit')
t('tool.other')
```

新增组件中的 `t()` 调用应参照同目录已有组件（如 `PermissionFooter` 使用 `t('chat.tool.xxx')`）。
