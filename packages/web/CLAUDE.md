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
| `src/domain/chat/messageParser.ts` | 消息解析器 |
| `src/components/ToolCard/knownTools.tsx` | 工具卡片注册 |
| `src/core/lib/query-keys.ts` | 查询缓存 Key |

## 移动端 Drawer 规范

所有移动端底部弹出 Drawer（`placement="bottom"`）必须遵守：

- **高度自适应**: `wrapper: { height: 'auto' }`
- **最高不超过 85%**: `wrapper: { maxHeight: '85vh' }`
- **底部安全边界**: `body: { paddingBottom: 'max(24px, env(safe-area-inset-bottom))' }`，防止被底部横条/圆角遮挡

## 测试

→ [docs/conventions/testing.md](../../docs/conventions/testing.md)

- 框架：vitest + @testing-library/react + jsdom
- 运行：`bun test`

## 架构文档

→ [docs/architecture/web/](../../docs/architecture/web/)
