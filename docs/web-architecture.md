# Web 前端架构

## 布局结构

三栏布局（桌面端）：
```
┌──────────────────────────────────────────────────────────┐
│                      MainLayout                          │
├────────┬─────────────────┬───────────────────────────────┤
│        │                 │                               │
│ RailNav│ ContentSidebar  │        Main Content           │
│ 56px   │    240px        │        (flex: 1)              │
│        │                 │                               │
│ 图标   │ 会话列表        │ 会话详情 / 设置               │
│ 导航   │ / 设置菜单      │                               │
│        │                 │                               │
└────────┴─────────────────┴───────────────────────────────┘
```

移动端（< 768px）：隐藏 ContentSidebar，全屏显示主内容区

## 关键文件

| 组件 | 路径 | 职责 |
|------|------|------|
| MainLayout | `web/src/components/layout/MainLayout.tsx` | 主布局容器，主题配置 |
| RailNav | `web/src/components/layout/RailNav.tsx` | 56px 图标导航栏 |
| ContentSidebar | `web/src/components/layout/ContentSidebar.tsx` | 240px 内容侧边栏 |
| SessionModule | `web/src/components/session/SessionModule.tsx` | 会话模块（列表 + 详情） |
| SessionDetail | `web/src/components/session/SessionDetail.tsx` | 会话详情（视图切换） |
| FileView | `web/src/components/files/FileView.tsx` | 文件视图（文件树 + Git） |
| SettingsModule | `web/src/components/settings/SettingsModule.tsx` | 设置模块 |
| uiStore | `web/src/stores/uiStore.ts` | UI 状态管理 |
| router | `web/src/router.tsx` | 路由配置 |

## 状态管理

使用 Zustand 管理 UI 状态：

```typescript
// uiStore 状态
{
  sessionViewMode: 'chat' | 'files' | 'terminal',  // 会话视图模式
  fileViewTab: 'files' | 'git',                    // 文件视图 Tab
  activeModule: 'sessions' | 'skills' | 'mcp' | 'settings',  // 激活的模块
  theme: 'light' | 'dark' | 'system',              // 主题
  locale: 'zh' | 'en',                             // 语言
  sidebarOpen: boolean,                            // 侧边栏开关
}
```

## 路由结构

```
/                    → MainLayout（默认显示 sessions 模块）
/login               → LoginPage（无布局）
/sessions/$sessionId → MainLayout（显示指定会话）
```

## 样式方案

- **CSS-in-JS**: @emotion/styled
- **组件库**: Ant Design 5.x
- **主题**: 使用 Ant Design tokens，支持 dark/light/system
- **图标**: lucide-react

## 长连接保持策略

视图切换时使用 `display: none` 隐藏组件，而非卸载：

```tsx
// ChatContainer 始终挂载，只是隐藏
<ChatWrapper $visible={sessionViewMode === 'chat'}>
  <ChatContainer sessionId={sessionId} />
</ChatWrapper>

// FileView 和 TerminalView 按需挂载
{sessionViewMode === 'files' && <FileView />}
{sessionViewMode === 'terminal' && <TerminalView />}
```

这样可以保持 WebSocket/SSE 连接不断开。

## 响应式设计

断点定义（与 Ant Design 一致）：

```typescript
const BREAKPOINTS = {
  xs: 576,
  sm: 576,
  md: 768,   // 移动端/桌面端分界点
  lg: 992,
  xl: 1200,
  xxl: 1600,
}
```

使用 `useIsMobile()` / `useIsDesktop()` hook 判断设备类型。

## 模块占位

Skills 和 MCP 模块暂未实现，显示占位文本：

```tsx
case 'skills':
case 'mcp':
  return <PlaceholderModule name={activeModule.toUpperCase()} />
```
