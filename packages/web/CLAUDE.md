# web

浏览器前端，提供 Claude Code 会话的远程交互界面。

## 编码规范

→ [docs/conventions/web.md](../../docs/conventions/web.md)

## 关键文件

| 文件 | 职责 |
|------|------|
| `src/router.tsx` | 路由配置 |
| `src/core/providers/SSEProvider.tsx` | SSE 连接管理 |
| `src/core/data/api/types.ts` | API 类型定义 |
| `src/domain/chat/normalize.ts` | 消息标准化（DecryptedMessage → NormalizedMessage） |
| `src/domain/chat/reducer.ts` | 消息归约（NormalizedMessage[] → ChatBlock[]） |
| `src/domain/chat/types.ts` | NormalizedMessage / ChatBlock 类型定义 |
| `src/components/tool-card/knownTools.tsx` | 工具卡片注册 |
| `src/core/lib/query-keys.ts` | 查询缓存 Key |
| `src/core/lib/fileAttachments.ts` | 文件附件类型与上传校验（分桶/MIME 投影单一来源 bucketCompletedAttachments） |
| `src/core/lib/composerDrafts.ts` | per-session 草稿持久化（分段结构 text/files/images/quotes，sessionStorage，旧格式兼容读取） |

## 移动端 Drawer 规范

所有移动端底部弹出 Drawer（`placement="bottom"`）**优先使用 `MobileDrawer`**（`src/components/ui/MobileDrawer.tsx`），以下不变量由组件统一收口，调用方不要再手动配置：

- **高度自适应 + 上限**：组件内置 `wrapper: { height: 'auto', maxHeight: '85dvh' }`（需调整上限时传 `maxHeight` prop）
- **底部安全边界**：sheet 自带 `paddingBottom: 'max(24px, env(safe-area-inset-bottom))'`——**禁止调用方往 `styles.body` 传 padding**（组件强制 `padding: 0`，body padding 会把 sheet 抬离屏底、露出 mask 空隙），同样禁止覆盖 `body.overflow` / `body.maxHeight`
- **开合动画 / header 下拉关闭 / 手势返回哨兵**：组件内置，`onClose` 消费者须**同步**决定是否关闭（异步决定会看到「沉降再滑出」弹跳）

仅当无需交互关闭的纯提示框（如 `SaveConflictDialog`，`maskClosable={false}` 且无拖拽关闭语义）可直接用 antd `Drawer`，手动配置：

- `styles.wrapper: { height: 'auto', maxHeight: '85dvh' }`
- `styles.body: { paddingBottom: 'max(24px, env(safe-area-inset-bottom))' }`

注意：这套手动配置**仅对原生 antd Drawer 生效**；同一 prop 传给 MobileDrawer 会被组件不变量覆盖（见上）。

## 跨格式字段访问

CLI 发送的数据字段格式不统一（下划线 `tool_use_result` / 驼峰 `toolUseResult`），访问时必须使用 `@mobi/shared` 的 `getField` 函数，禁止手写双格式判断：

```typescript
import { getField } from '@mobi/shared'

// 正确
getField(data, 'parentUuid')       // 自动尝试 parentUuid → parent_uuid
getField(data, 'tool_use_result')  // 自动尝试 tool_use_result → toolUseResult

// 错误 — 遗漏即出 bug
data.parentUuid ?? data.parent_uuid
isObject(rawData.tool_use_result) ? rawData.tool_use_result : isObject(rawData.toolUseResult) ? rawData.toolUseResult : null
```

## 测试

→ [docs/conventions/testing.md](../../docs/conventions/testing.md)

- 框架：vitest + @testing-library/react + jsdom
- 运行：`vitest run`（禁止 `bun test`，会忽略 vitest.config.ts 的 jsdom 配置）

## 架构文档

→ [docs/architecture/web/](../../docs/architecture/web/)
