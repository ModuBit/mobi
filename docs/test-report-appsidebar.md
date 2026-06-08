# AppSidebar 布局重构 — 测试报告

> 日期：2026-06-08
> 分支：fist-milestone
> 提交范围：34bbbb8..35bf6a2

## 一、自动化测试

### Typecheck ✅

```
shared: ✅ 通过
hub:    ✅ 通过
cli:    ✅ 通过
web:    ✅ 通过
```

### 单元测试 ✅

| 包 | 测试数 | 结果 |
|---|---|---|
| shared | 144 | ✅ 全部通过 |
| hub | 134 | ✅ 全部通过 |
| cli | 277 (3 skipped) | ✅ 全部通过 |
| web | 505 | ✅ 全部通过 |
| **合计** | **1060** | **✅ 全部通过** |

### Lint ✅

```
ESLint: 0 errors, 230 warnings (均为预先存在的)
依赖方向: 0 errors, 14 warnings (均为预先存在的)
```

## 二、E2E 测试

### 环境信息

- Hub: http://localhost:2224
- Web: http://localhost:5175
- Runner: PID 18566

### 测试用例与结果

| # | 测试项 | 结果 | 说明 |
|---|---|---|---|
| 1 | 登录流程 | ✅ | 输入 token → Connect → 跳转 `/sessions/new` |
| 2 | 侧边栏渲染 | ✅ | 240px 宽，Logo + 收起按钮 + 导航项（New Chat/Search/MCP/Automation）+ 主题/语言切换 + 用户按钮 |
| 3 | 侧边栏收起 | ✅ | 点击收起按钮 → 侧边栏消失，内容区全屏，出现汉堡按钮 |
| 4 | 侧边栏展开 | ✅ | 点击汉堡按钮 → 侧边栏恢复 |
| 5 | 新对话页面布局 | ✅ | 居中 sender 卡片（720px），动态标题 + 配置栏 + 输入框 |
| 6 | 动态标题（无目录） | ✅ | 显示「你想做什么？」「有什么新想法？」「开始一段新对话」（随机） |
| 7 | 动态标题（有目录） | ✅ | 输入 `/Users/manerfan/workspace` 后标题变为「来聊聊 workspace 吧」 |
| 8 | 配置栏 - 权限模式 | ✅ | Default 选项，下拉可选 |
| 9 | 配置栏 - 推理深度 | ✅ | Medium 选项，下拉可选 |
| 10 | 配置栏 - 模型 | ✅ | Sonnet 选项，下拉可选 |
| 11 | 配置栏 - Agent | ✅ | Claude Code 选项，下拉可选 |
| 12 | 配置栏 - 机器选择 | ✅ | 显示 `linmomodeMac-mini.local`，可选择 |
| 13 | 配置栏 - 项目目录 | ⚠️→✅ | 原问题：Select 清空自由输入 → 已修复为 AutoComplete |
| 14 | 路由重定向 `/` | ✅ | 自动跳转到 `/sessions/new` |
| 15 | 用户 Dropdown | ⚠️→✅ | 原问题：点击未弹出 → 已修复 `as="div"` 为 `type="button"` |
| 16 | 导航项 - New Chat | ✅ | 点击跳转 `/sessions/new` |
| 17 | 导航项 - Search/MCP/Automation | ✅ | 灰色禁用状态，不可点击 |
| 18 | 主题切换 | ✅ | 点击切换 dark/light |
| 19 | 语言切换 | ✅ | 显示「中」/「En」按钮 |

### E2E 发现并修复的问题

| 问题 | 严重度 | 状态 | 修复提交 |
|------|--------|------|----------|
| 目录选择器使用 Select，自由输入路径被清空 | Medium | ✅ 已修复 | 改用 AutoComplete 组件 |
| SidebarFooter 用户 Dropdown 不响应点击 | Medium | ✅ 已修复 | `as="div"` → `type="button"` |

## 三、变更文件汇总

### 新增文件（7 个）

| 文件 | 职责 |
|------|------|
| `packages/web/src/components/layout/AppSidebar.tsx` | 240px 宽侧边栏主组件 |
| `packages/web/src/components/layout/SidebarHeader.tsx` | Logo + 收起按钮 |
| `packages/web/src/components/layout/SidebarNav.tsx` | 导航项列表 |
| `packages/web/src/components/layout/SidebarFooter.tsx` | 主题/语言切换 + 用户 Dropdown |
| `packages/web/src/components/layout/SidebarProjects.tsx` | 项目分组会话列表 |
| `packages/web/src/components/layout/SidebarSessionItem.tsx` | 紧凑会话列表项 |
| `packages/web/src/components/layout/usePwaInstall.ts` | PWA 安装 hook |

### 删除文件（2 个）

| 文件 | 原因 |
|------|------|
| `packages/web/src/components/layout/RailNav.tsx` | 被 AppSidebar 替代 |
| `packages/web/src/pages/SessionsPage.tsx` | 会话列表合并到 AppSidebar |

### 修改文件（8 个）

| 文件 | 变更 |
|------|------|
| `uiStore.ts` | 新增 sidebarExpanded / toggleSidebar |
| `navConfig.ts` | 更新导航项配置 |
| `MainLayout.tsx` | 替换 RailNav → AppSidebar + 汉堡按钮 |
| `SessionListDrawer.tsx` | 桌面端不再渲染 |
| `router.tsx` | 移除 SessionsPage 路由，调整重定向 |
| `NewSessionPage.tsx` | 重构为 sender 内嵌配置 |
| `preferences.ts` | 新增 permissionMode 持久化 |
| `zh.json / en.json` | 新增 i18n 翻译 key |

## 四、总结

AppSidebar 布局重构已完成，所有自动化测试通过，E2E 验证中发现的 2 个问题已修复。核心功能（侧边栏展开/收起、导航、新对话页面 sender 内嵌配置、项目分组会话列表、路由重定向）均正常工作。
