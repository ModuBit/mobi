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
| `src/core/lib/fileAttachments.ts` | 文件附件类型与上传校验 |

## 移动端 Drawer 规范

所有移动端底部弹出 Drawer（`placement="bottom"`）必须遵守：

- **高度自适应**: `wrapper: { height: 'auto' }`
- **最高不超过 85%**: `wrapper: { maxHeight: '85vh' }`
- **底部安全边界**: `body: { paddingBottom: 'max(24px, env(safe-area-inset-bottom))' }`，防止被底部横条/圆角遮挡

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
