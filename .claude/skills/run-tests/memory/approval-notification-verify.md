---
name: approval-notification-verify
description: 审批通知卡片（通知里就地渲染 PermissionFooter / AskUserQuestion）全链路验证 —— 双会话、Playwright 兜底、antd v6 通知内容独立 React 根
metadata:
  type: recipe
  last_verified: 2026-10-21
---

# 审批通知卡片验证

验证「前台在别的会话时，审批 / AskUserQuestion 以可操作卡片弹在通知里」：
**A 会话发起审批，B 会话页面接收通知**。浏览器操作与卡片交互都在 B 页面完成。

## 前置：两条会话

- 无项目的环境先建工作区（folder 必须在 home 内，如 `~/workspace/demo`）
- 会话必须走 spawn API（seed 不生效，见 [[tool-ui-verify]]），`permissionMode: "default"`：
  `POST /api/sessions/spawn { directory, workspaceId, permissionMode: "default" }`
- 记下两条 id：B = 观看方（浏览器打开），A = 发起方（只通过 API 发消息）

## 触发审批（不切页面）

从 B 页面同源 fetch 发消息给 A（Playwright 用 `page.request.post('/api/sessions/<A>/messages', { data: { content } })`，
cookie 自动带上）：

- 普通审批：必须用**写命令/写文件**。`ls -la` 这类只读命令在 default 模式也会被 CC 直接放行，
  不会产生 pending request（2026-10-21 实踩，白等 90s）。
  例：`请用 Bash 工具执行这条命令：echo x > /tmp/xxx.txt （只执行这一条，不要做别的）`
- AskUserQuestion：`用 AskUserQuestion 工具问我两个问题：1) …？2) …？每题两个选项。只调用这个工具，不要做别的。`

轮询 `.ant-notification-notice` 出现即可（模型 glm-5.3-flash 实测 ~5–20s）。

## 断言面

| 操作 | 断言 |
|---|---|
| 卡片内容 | 通知里有 `本次会话允许 / 当前项目允许（本地）/ 允许 / 拒绝 / 带原因拒绝`；Ask 卡片有题签 + 选项 |
| 点「允许」 | 文件真落盘；通知数变 0；**URL 不变**（操作不跳转） |
| 作答 Ask | 首题选完切到最后一个题签才有「提交」（footer 只在末题渲染提交按钮）；提交后通知消失、`agentState.requests` 空 |
| 点通知标题/空白 | URL 变成 `/sessions/<A>` 且通知消失（跳转能力保留） |

答完可用 mention 验证闭环：A 的聊天记录出现「收到，你的选择：1 … 2 …」。

## 坑

- **antd v6 通知内容渲染在独立 React 根，不继承主树 context**（2026-10-21 实锤）：卡片里的
  `useQueryClient()` 直接抛 `No QueryClient set`，通知弹不出来（页面只报 `PAGEERROR`）。
  修法 = 在 `description` 里重新套 `QueryClientProvider` + `ThemeProvider`；否则 antd token 也是默认值
- **antd v6 `message` 已废弃**：用 `title`，否则控制台刷 deprecation
- **按钮文本带图标**：`hasText: /^允许$/` 匹配不到（可访问名含 ✓）。用
  `locator('... button').evaluateAll(bs => bs.findIndex(b => b.textContent.trim() === '允许'))` 再 `nth(i).click()`
- **Chrome DevTools MCP 可能被别的会话占用**（`browser already running for chrome-profile`）：
  MCP 连不上时用 Playwright `chromium.launchPersistentContext(profile, { channel: 'chrome', headless: false, permissions: ['notifications'] })`
  兜底——用系统 Chrome、独立 profile，不碰别人的自动化实例。登录页中文：`input[type=password]` + 按钮「连接」
- **bootstrap 后台任务有 30min 上限**：超时被杀会触发 trap 清空数据目录（会话/工作区全丢），
  跑长流程要 `timeout: 3600000` 起
- 通知权限需 `permissions: ['notifications']`，否则先弹「开启通知」引导通知，干扰等待条件
